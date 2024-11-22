#!/usr/bin/env node

import meow from 'meow';
import ora from 'ora';
import chalk from 'chalk';
import { glob } from 'glob';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { filesize as formatFileSize } from 'filesize';
import { isBinaryFile } from 'isbinaryfile';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const helpText = `
  ${chalk.bold('Usage')}
    $ git2txt <repository-url>

  ${chalk.bold('Options')}
    --output, -o     Specify output file path
    --threshold, -t  Set file size threshold in MB (default: 0.5)
    --include-all    Include all files regardless of size or type
    --debug         Enable debug mode with verbose logging
    --help          Show help
    --version       Show version

  ${chalk.bold('Examples')}
    $ git2txt https://github.com/username/repository
    $ git2txt https://github.com/username/repository --output=output.txt
`;

// Prevent process.exit in test environment
const exit = (code) => {
    if (process.env.NODE_ENV === 'test') {
        throw new Error(`Exit called with code: ${code}`);
    } else {
        process.exit(code);
    }
};

export const cli = meow(helpText, {
    importMeta: import.meta,
    flags: {
        output: {
            type: 'string',
            shortFlag: 'o'
        },
        threshold: {
            type: 'number',
            shortFlag: 't',
            default: 0.1
        },
        includeAll: {
            type: 'boolean',
            default: false
        },
        debug: {
            type: 'boolean',
            default: false
        }
    }
});

function normalizeGitHubUrl(url) {
    try {
        // Remove trailing slashes
        url = url.replace(/\/+$/, '');
        
        // Handle git@ URLs
        if (url.startsWith('git@github.com:')) {
            return url;
        }
        
        // Handle full HTTPS URLs
        if (url.startsWith('https://github.com/')) {
            return url;
        }
        
        // Handle short format (user/repo)
        if (url.match(/^[\w-]+\/[\w-]+$/)) {
            return `https://github.com/${url}`;
        }
        
        throw new Error('Invalid GitHub repository URL format');
    } catch (error) {
        throw new Error(`Invalid GitHub URL: ${url}`);
    }
}

export async function validateInput(input) {
    if (!input || input.length === 0) {
        throw new Error('Repository URL is required');
    }

    const url = input[0];
    if (!url.includes('github.com') && !url.match(/^[\w-]+\/[\w-]+$/)) {
        throw new Error('Only GitHub repositories are supported');
    }

    return url;
}

export async function downloadRepository(url) {
    const spinner = process.env.NODE_ENV !== 'test' ? ora('Downloading repository...').start() : null;
    const tempDir = path.join(os.tmpdir(), `git2txt-${Date.now()}`);

    try {
        // Normalize the GitHub URL
        const normalizedUrl = normalizeGitHubUrl(url);
        const repoName = url.split('/').pop().replace('.git', '');
        
        if (cli.flags.debug) {
            console.log(chalk.blue('Debug: Normalized URL:'), normalizedUrl);
            console.log(chalk.blue('Debug: Temp directory:'), tempDir);
        }

        // Create temp directory
        await fs.mkdir(tempDir, { recursive: true });

        // Clone the repository
        const cloneCommand = `git clone --depth 1 ${normalizedUrl} ${tempDir}`;
        
        if (cli.flags.debug) {
            console.log(chalk.blue('Debug: Executing command:'), cloneCommand);
        }

        await execAsync(cloneCommand, {
            maxBuffer: 1024 * 1024 * 100 // 100MB buffer
        });
        
        // Verify the download
        const files = await fs.readdir(tempDir);
        if (files.length === 0) {
            throw new Error('Repository appears to be empty');
        }

        if (spinner) spinner.succeed('Repository downloaded successfully');
        return { tempDir, repoName };
    } catch (error) {
        if (spinner) spinner.fail('Failed to download repository');
        
        if (cli.flags.debug) {
            console.log(chalk.blue('Debug: Full error:'), error);
        }
        
        if (process.env.NODE_ENV !== 'test') {
            console.error(chalk.red('Error: Could not access the repository. Please check:'));
            console.error(chalk.yellow('  1. The repository exists and is public'));
            console.error(chalk.yellow('  2. You have the correct repository URL'));
            console.error(chalk.yellow('  3. GitHub is accessible from your network'));
            console.error(chalk.yellow('  4. Git is installed and accessible from command line'));
        }
        
        await cleanup(tempDir);
        throw error;
    }
}

export async function processFiles(directory, options) {
    let spinner = process.env.NODE_ENV !== 'test' ? ora('Processing files...').start() : null;
    const thresholdBytes = options.threshold * 1024 * 1024;
    let output = '';
    let processedFiles = 0;
    let skippedFiles = 0;

    async function processDirectory(dir) {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
                // Recursively process subdirectories
                await processDirectory(fullPath);
                continue;
            }

            if (!entry.isFile()) continue;

            try {
                const stats = await fs.stat(fullPath);

                // Skip if file is too large and we're not including all files
                if (!options.includeAll && stats.size > thresholdBytes) {
                    if (process.env.DEBUG) console.log(`Skipping large file: ${entry.name}`);
                    skippedFiles++;
                    continue;
                }

                // Skip binary files unless includeAll is true
                if (!options.includeAll) {
                    if (await isBinaryFile(fullPath)) {
                        if (process.env.DEBUG) console.log(`Skipping binary file: ${entry.name}`);
                        skippedFiles++;
                        continue;
                    }
                }

                const content = await fs.readFile(fullPath, 'utf8');
                const relativePath = path.relative(directory, fullPath);
                
                output += `\n${'='.repeat(80)}\n`;
                output += `File: ${relativePath}\n`;
                output += `Size: ${formatFileSize(stats.size)}\n`;
                output += `${'='.repeat(80)}\n\n`;
                output += `${content}\n`;
                
                processedFiles++;

                if (process.env.DEBUG) {
                    console.log(`Processed file: ${relativePath}`);
                }
            } catch (error) {
                if (process.env.DEBUG) {
                    console.error(`Error processing ${entry.name}:`, error);
                }
                skippedFiles++;
            }
        }
    }

    try {
        // Process the entire directory tree
        await processDirectory(directory);

        if (spinner) {
            spinner.succeed(`Processed ${processedFiles} files successfully (${skippedFiles} skipped)`);
        }

        if (processedFiles === 0 && process.env.DEBUG) {
            console.warn('Warning: No files were processed');
        }

        return output;

    } catch (error) {
        if (spinner) {
            spinner.fail('Failed to process files');
        }
        throw error;
    }
}

export async function writeOutput(content, outputPath) {
    let spinner = process.env.NODE_ENV !== 'test' ? ora('Writing output file...').start() : null;

    try {
        await fs.writeFile(outputPath, content);
        if (spinner) spinner.succeed(`Output saved to ${chalk.green(outputPath)}`);
    } catch (error) {
        if (spinner) spinner.fail('Failed to write output file');
        if (process.env.NODE_ENV !== 'test') {
            console.error(chalk.red('Write error:'), error);
        }
        throw error;
    }
}

export async function cleanup(directory) {
    try {
        await fs.rm(directory, { recursive: true, force: true });
    } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
            console.error(chalk.yellow('Warning: Failed to clean up temporary files'));
        }
    }
}

export async function main() {
    let tempDir;
    try {
        const url = await validateInput(cli.input);
        if (process.env.NODE_ENV !== 'test') {
            const result = await downloadRepository(url);
            tempDir = result.tempDir;
            
            const outputPath = cli.flags.output || `${result.repoName}.txt`;
            const content = await processFiles(tempDir, {
                threshold: cli.flags.threshold,
                includeAll: cli.flags.includeAll
            });

            if (!content) {
                throw new Error('No content was generated from the repository');
            }

            await writeOutput(content, outputPath);
        }
    } catch (error) {
        if (process.env.NODE_ENV === 'test') {
            throw error;
        } else {
            console.error(chalk.red('\nAn unexpected error occurred:'));
            console.error(error.message || error);
            exit(1);
        }
    } finally {
        if (tempDir) {
            await cleanup(tempDir);
        }
    }
}

// Only run main if not in test environment
if (process.env.NODE_ENV !== 'test') {
    main();
}