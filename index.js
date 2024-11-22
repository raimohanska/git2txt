#!/usr/bin/env node

import meow from 'meow';
import degit from 'degit';
import ora from 'ora';
import chalk from 'chalk';
import { glob } from 'glob';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { filesize as formatFileSize } from 'filesize';
import { isBinaryFile } from 'isbinaryfile';
import os from 'os';


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
            default: 0.5
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
        
        // Handle full HTTPS URLs
        if (url.startsWith('https://github.com/')) {
            url = url.replace('https://github.com/', '');
        }
        
        // Handle git@ URLs
        if (url.startsWith('git@github.com:')) {
            url = url.replace('git@github.com:', '');
        }
        
        // Split into owner and repo
        const [owner, repo] = url.split('/');
        
        if (!owner || !repo) {
            throw new Error('Invalid GitHub repository URL format');
        }
        
        return `github:${owner}/${repo}`;  // Changed to use github: prefix
    } catch (error) {
        throw new Error(`Invalid GitHub URL: ${url}`);
    }
}

export async function validateInput(input) {
    if (input.length === 0) {
        console.error(chalk.red('Error: Repository URL is required'));
        process.exit(1);
    }

    const url = input[0];
    if (!url.includes('github.com') && !url.match(/^[\w-]+\/[\w-]+$/)) {
        console.error(chalk.red('Error: Only GitHub repositories are supported'));
        process.exit(1);
    }

    return url;
}

export async function downloadRepository(url) {
    const spinner = ora('Downloading repository...').start();
    const tempDir = path.join(os.tmpdir(), `git2txt-${Date.now()}`);

    try {
        // Normalize the GitHub URL
        const normalizedUrl = normalizeGitHubUrl(url);
        const repoName = normalizedUrl.split('/').pop();
        
        if (cli.flags.debug) {
            console.log(chalk.blue('Debug: Normalized URL:'), normalizedUrl);
            console.log(chalk.blue('Debug: Temp directory:'), tempDir);
        }

        // Create degit emitter with specific options
        const emitter = degit(normalizedUrl, {
            force: true,
            verbose: cli.flags.debug
        });

        // Add info handler for debugging
        emitter.on('info', info => {
            if (cli.flags.debug) {
                console.log(chalk.blue('Debug:'), info.message);
            }
        });

        await emitter.clone(tempDir);
        
        // Verify the download
        const files = await fs.readdir(tempDir);
        if (cli.flags.debug) {
            console.log(chalk.blue('Debug: Downloaded files:'), files);
        }
        
        if (files.length === 0) {
            throw new Error('Repository appears to be empty');
        }

        spinner.succeed('Repository downloaded successfully');
        return { tempDir, repoName };
    } catch (error) {
        spinner.fail('Failed to download repository');
        
        if (cli.flags.debug) {
            console.log(chalk.blue('Debug: Full error:'), error);
        }
        
        // Provide more helpful error messages
        if (error.code === 'MISSING_REF') {
            console.error(chalk.red('Error: Could not access the repository. Please check:'));
            console.error(chalk.yellow('  1. The repository exists and is public'));
            console.error(chalk.yellow('  2. You have the correct repository URL'));
            console.error(chalk.yellow('  3. GitHub is accessible from your network'));
        } else {
            console.error(chalk.red('Download error:'), error.message || error);
        }
        
        // Clean up temp directory in case of failure
        await cleanup(tempDir);
        process.exit(1);
    }
}

export async function processFiles(directory, options) {
    const spinner = ora('Processing files...').start();
    const thresholdBytes = options.threshold * 1024 * 1024;
    let output = '';
    let processedFiles = 0;
    let skippedFiles = 0;

    try {
        if (cli.flags.debug) {
            console.log(chalk.blue('Debug: Processing directory:'), directory);
        }

        const files = await glob('**/*', {
            cwd: directory,
            dot: true,
            ignore: ['**/node_modules/**', '**/.git/**'],
            nodir: true
        });

        if (cli.flags.debug) {
            console.log(chalk.blue('Debug: Found files:'), files);
        }

        for (const file of files) {
            const filePath = path.join(directory, file);
            const stats = await fs.stat(filePath);

            if (cli.flags.debug) {
                console.log(chalk.blue(`Debug: Processing ${file}`), `(${formatFileSize(stats.size)})`);
            }

            if (!options.includeAll) {
                if (stats.size > thresholdBytes) {
                    if (cli.flags.debug) {
                        console.log(chalk.blue(`Debug: Skipping ${file} (size > threshold)`));
                    }
                    skippedFiles++;
                    continue;
                }

                try {
                    const isBinary = await isBinaryFile(filePath);
                    if (isBinary) {
                        if (cli.flags.debug) {
                            console.log(chalk.blue(`Debug: Skipping ${file} (binary file)`));
                        }
                        skippedFiles++;
                        continue;
                    }
                } catch (error) {
                    if (cli.flags.debug) {
                        console.log(chalk.blue(`Debug: Error checking binary ${file}`), error);
                    }
                    skippedFiles++;
                    continue;
                }
            }

            try {
                const content = await fs.readFile(filePath, 'utf8');
                output += `\n${'='.repeat(80)}\n`;
                output += `File: ${file}\n`;
                output += `Size: ${formatFileSize(stats.size)}\n`;
                output += `${'='.repeat(80)}\n\n`;
                output += `${content}\n`;
                processedFiles++;
                
                if (cli.flags.debug) {
                    console.log(chalk.blue(`Debug: Successfully processed ${file}`));
                }
            } catch (error) {
                if (cli.flags.debug) {
                    console.log(chalk.blue(`Debug: Error reading ${file}`), error);
                }
                skippedFiles++;
                continue;
            }
        }

        spinner.succeed(`Processed ${processedFiles} files successfully (${skippedFiles} skipped)`);
        return output;
    } catch (error) {
        spinner.fail('Failed to process files');
        console.error(chalk.red('Processing error:'), error);
        process.exit(1);
    }
}

// writeOutput and cleanup functions remain the same...
export async function writeOutput(content, outputPath) {
    const spinner = ora('Writing output file...').start();

    try {
        await fs.writeFile(outputPath, content);
        spinner.succeed(`Output saved to ${chalk.green(outputPath)}`);
    } catch (error) {
        spinner.fail('Failed to write output file');
        console.error(chalk.red('Write error:'), error);
        process.exit(1);
    }
}

export async function cleanup(directory) {
    try {
        await fs.rm(directory, { recursive: true, force: true });
    } catch (error) {
        console.error(chalk.yellow('Warning: Failed to clean up temporary files'));
    }
}

// Modified main program with better error handling
export async function main() {
    let tempDir;
    try {
        if (cli.flags.debug) {
            console.log(chalk.blue('Debug: Starting with input:'), cli.input);
            console.log(chalk.blue('Debug: Options:'), cli.flags);
        }

        const url = await validateInput(cli.input);
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
    } catch (error) {
        console.error(chalk.red('\nAn unexpected error occurred:'));
        console.error(error.message || error);
        process.exit(1);
    } finally {
        if (tempDir) {
            await cleanup(tempDir);
        }
    }
}

// Only run main if this is the main module
main();