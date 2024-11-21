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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Export functions for testing
export async function validateInput(input) {
    if (input.length === 0) {
        throw new Error('Repository URL is required');
    }

    const url = input[0];
    if (!url.includes('github.com')) {
        throw new Error('Only GitHub repositories are supported');
    }

    return url;
}

export async function downloadRepository(url) {
    const spinner = ora('Downloading repository...').start();
    const repoName = url.split('/').pop();
    const tempDir = path.join(os.tmpdir(), `git2txt-${Date.now()}`);

    try {
        const emitter = degit(url, {
            force: true,
            verbose: false
        });

        await emitter.clone(tempDir);
        spinner.succeed('Repository downloaded successfully');
        console.log(chalk.blue(`Repository cloned to: ${tempDir}`));
        return { tempDir, repoName };
    } catch (error) {
        spinner.fail('Failed to download repository');
        console.error(chalk.red(error.message));
        throw error;
    }
}

export async function processFiles(directory, options) {
    const spinner = ora('Processing files...').start();
    const thresholdBytes = options.threshold * 1024 * 1024; // Convert MB to bytes
    let output = '';
    let processedFiles = 0;
    let skippedFiles = 0;

    try {
        console.log(chalk.blue(`\nScanning directory: ${directory}`));
        const files = await glob('**/*', {
            cwd: directory,
            dot: true,
            ignore: ['**/node_modules/**', '**/.git/**'],
            nodir: true
        });

        console.log(chalk.blue(`Found ${files.length} files to process`));

        for (const file of files) {
            const filePath = path.join(directory, file);
            const stats = await fs.stat(filePath);

            console.log(chalk.gray(`\nProcessing: ${file}`));
            console.log(chalk.gray(`File size: ${formatFileSize(stats.size)}`));

            // Skip files based on size and type unless --include-all is set
            if (!options.includeAll) {
                if (stats.size > thresholdBytes) {
                    console.log(chalk.yellow(`Skipping: File exceeds size threshold (${formatFileSize(thresholdBytes)})`));
                    skippedFiles++;
                    continue;
                }

                try {
                    const isBinary = await isBinaryFile(filePath);
                    if (isBinary) {
                        console.log(chalk.yellow('Skipping: Binary file detected'));
                        skippedFiles++;
                        continue;
                    }
                } catch (error) {
                    console.log(chalk.yellow('Skipping: Unable to determine if file is binary'));
                    skippedFiles++;
                    continue;
                }
            }

            try {
                console.log(chalk.green('Reading file content...'));
                const content = await fs.readFile(filePath, 'utf8');
                
                output += `\n${'='.repeat(80)}\n`;
                output += `File: ${file}\n`;
                output += `Size: ${formatFileSize(stats.size)}\n`;
                output += '$'.repeat(80) + '\n\n';
                output += `${content}\n`;
                
                processedFiles++;
                console.log(chalk.green('File content added to output'));
                
                // Update spinner text to show progress
                spinner.text = `Processing files... (${processedFiles}/${files.length})`;
            } catch (error) {
                console.log(chalk.red(`Error reading file: ${error.message}`));
                skippedFiles++;
                continue;
            }
        }

        console.log(chalk.blue(`\nSummary:`));
        console.log(chalk.blue(`- Total files found: ${files.length}`));
        console.log(chalk.green(`- Files processed: ${processedFiles}`));
        console.log(chalk.yellow(`- Files skipped: ${skippedFiles}`));

        spinner.succeed(`Processed ${processedFiles} files successfully`);
        
        return output;
    } catch (error) {
        spinner.fail('Failed to process files');
        console.error(chalk.red(error.message));
        throw error;
    }
}

export async function writeOutput(content, outputPath) {
    const spinner = ora('Writing output file...').start();

    try {
        console.log(chalk.blue(`Writing ${content.length} characters to ${outputPath}`));
        await fs.writeFile(outputPath, content);
        spinner.succeed(`Output saved to ${chalk.green(outputPath)}`);
    } catch (error) {
        spinner.fail('Failed to write output file');
        console.error(chalk.red(error.message));
        throw error;
    }
}

export async function cleanup(directory) {
    try {
        await fs.rm(directory, { recursive: true, force: true });
        console.log(chalk.blue(`Cleaned up temporary directory: ${directory}`));
    } catch (error) {
        console.error(chalk.yellow('Warning: Failed to clean up temporary files'));
        throw error;
    }
}

const cli = meow(`
  ${chalk.bold('Usage')}
    $ git2txt <repository-url>

  ${chalk.bold('Options')}
    --output, -o     Specify output file path
    --threshold, -t  Set file size threshold in MB (default: 0.5)
    --include-all    Include all files regardless of size or type
    --help          Show help
    --version       Show version

  ${chalk.bold('Examples')}
    $ git2txt https://github.com/username/repository
    $ git2txt https://github.com/username/repository --output=output.txt
    $ git2txt https://github.com/username/repository --threshold=2
    $ git2txt https://github.com/username/repository --include-all
`, {
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
        }
    }
});

// Only run the main function if this file is being run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    async function main() {
        try {
            const url = await validateInput(cli.input);
            const { tempDir, repoName } = await downloadRepository(url);
            
            const outputPath = cli.flags.output || `${repoName}.txt`;
            const content = await processFiles(tempDir, {
                threshold: cli.flags.threshold,
                includeAll: cli.flags.includeAll
            });

            await writeOutput(content, outputPath);
            await cleanup(tempDir);
        } catch (error) {
            console.error(chalk.red('An unexpected error occurred:'));
            console.error(error);
            process.exit(1);
        }
    }

    main();
}
