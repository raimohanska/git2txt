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

// Help text for consistent display
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

export async function validateInput(input) {
    if (input.length === 0) {
        console.error(chalk.red('Error: Repository URL is required'));
        process.exit(1);
    }

    const url = input[0];
    if (!url.includes('github.com')) {
        console.error(chalk.red('Error: Only GitHub repositories are supported'));
        process.exit(1);
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
            verbose: true
        });

        await emitter.clone(tempDir);
        spinner.succeed('Repository downloaded successfully');
        return { tempDir, repoName };
    } catch (error) {
        spinner.fail('Failed to download repository');
        console.error(chalk.red('Download error:'), error);
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
        const files = await glob('**/*', {
            cwd: directory,
            dot: true,
            ignore: ['**/node_modules/**', '**/.git/**'],
            nodir: true
        });

        for (const file of files) {
            const filePath = path.join(directory, file);
            const stats = await fs.stat(filePath);

            if (!options.includeAll) {
                if (stats.size > thresholdBytes) {
                    skippedFiles++;
                    continue;
                }

                try {
                    const isBinary = await isBinaryFile(filePath);
                    if (isBinary) {
                        skippedFiles++;
                        continue;
                    }
                } catch {
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
            } catch {
                skippedFiles++;
                continue;
            }
        }

        spinner.succeed(`Processed ${processedFiles} files successfully`);
        return output;
    } catch (error) {
        spinner.fail('Failed to process files');
        console.error(chalk.red('Processing error:'), error);
        process.exit(1);
    }
}

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

// Run the main program
export async function main() {
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
        console.error(chalk.red('\nAn unexpected error occurred:'));
        console.error(error);
        process.exit(1);
    }
}

main();