import test from 'ava';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import the functions to test
import {
    validateInput,
    processFiles,
    writeOutput,
    cleanup,
    main,
    cli
} from '../index.js';

// Helper function to create test file and verify its existence
async function createTestFile(filepath, content) {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, content);
    const exists = await fs.access(filepath).then(() => true).catch(() => false);
    if (!exists) {
        throw new Error(`Failed to create test file: ${filepath}`);
    }
    return exists;
}

// Helper function to execute CLI
async function executeCLI(args = []) {
    const cliPath = path.join(__dirname, '..', 'index.js');
    try {
        const { stdout, stderr } = await execFileAsync('node', [cliPath, ...args], {
            env: { ...process.env, NODE_ENV: 'test' }
        });
        return { stdout, stderr };
    } catch (error) {
        return { stdout: error.stdout, stderr: error.stderr, error };
    }
}

// Setup test environment
test.beforeEach(async t => {
    // Store original argv
    t.context.originalArgv = process.argv;
    
    // Create temp directory for tests
    const tempDir = path.join(os.tmpdir(), `git2txt-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    t.context.tempDir = tempDir;
});

// Cleanup after each test
test.afterEach(async t => {
    // Restore original argv
    process.argv = t.context.originalArgv;
    
    // Clean up temp directory
    if (t.context.tempDir) {
        await fs.rm(t.context.tempDir, { recursive: true, force: true }).catch(() => {});
    }
});

test('validateInput throws error on empty input', async t => {
    await t.throwsAsync(
        () => validateInput([]),
        { message: 'Repository URL is required' }
    );
});

test('validateInput throws error on non-GitHub URL', async t => {
    await t.throwsAsync(
        () => validateInput(['https://gitlab.com/user/repo']),
        { message: 'Only GitHub repositories are supported' }
    );
});

test('validateInput returns valid GitHub URL', async t => {
    const url = 'https://github.com/octocat/Spoon-Knife';
    const result = await validateInput([url]);
    t.is(result, url);
});

/*
test('processFiles processes repository files', async t => {
    const testDir = path.join(t.context.tempDir, 'test-repo');
    
    try {
        // Create directory with verification
        await fs.mkdir(testDir, { recursive: true });
        const dirExists = await fs.access(testDir).then(() => true).catch(() => false);
        t.true(dirExists, 'Test directory should exist');
        
        // Create test files with verification
        const testFiles = {
            'test1.txt': 'Test content 1',
            'test2.txt': 'Test content 2'
        };

        // Write files and verify
        for (const [filename, content] of Object.entries(testFiles)) {
            const filePath = path.join(testDir, filename);
            await fs.writeFile(filePath, content, 'utf8');
            
            // Verify file exists
            const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
            t.true(fileExists, `${filename} should exist`);
            
            // Verify content
            const readContent = await fs.readFile(filePath, 'utf8');
            t.is(readContent, content, `${filename} should have correct content`);
        }
        
        // Verify directory contents before processing
        const beforeFiles = await fs.readdir(testDir);
        console.log('Files before processing:', beforeFiles);
        t.is(beforeFiles.length, 2, 'Should have 2 test files');
        
        // Process files with extra logging
        console.log('Starting file processing...');
        const output = await processFiles(testDir, {
            threshold: 1,
            includeAll: true,
            debug: true
        });
        console.log('Processing complete. Output length:', output?.length ?? 0);
        
        // Detailed output verification
        if (!output) {
            console.log('No output generated');
            t.fail('Expected output to be generated');
            return;
        }
        
        // Verify each file and content
        for (const [filename, content] of Object.entries(testFiles)) {
            const hasContent = output.includes(content);
            const hasFilename = output.includes(`File: ${filename}`);
            
            t.true(hasContent, 
                `Missing content for ${filename}\nExpected: "${content}"\nGot output: ${output}`);
            t.true(hasFilename, 
                `Missing filename ${filename} in output\nGot output: ${output}`);
        }
        
    } catch (error) {
        console.error('Test error:', error);
        
        // Check directory state
        try {
            const exists = await fs.access(testDir).then(() => true).catch(() => false);
            if (exists) {
                const contents = await fs.readdir(testDir);
                console.log('Final directory contents:', contents);
                
                // Try to read files
                for (const file of contents) {
                    const content = await fs.readFile(path.join(testDir, file), 'utf8');
                    console.log(`Content of ${file}:`, content);
                }
            } else {
                console.log('Directory does not exist');
            }
        } catch (e) {
            console.error('Error checking directory state:', e);
        }
        
        throw error;
    }
});
*/

test('writeOutput writes content to file', async t => {
    const outputPath = path.join(t.context.tempDir, 'output.txt');
    const content = 'Test content';
    
    await writeOutput(content, outputPath);
    
    const fileContent = await fs.readFile(outputPath, 'utf8');
    t.is(fileContent, content);
});

test('cleanup removes temporary directory', async t => {
    const tempDir = path.join(t.context.tempDir, 'cleanup-test');
    await createTestFile(path.join(tempDir, 'test.txt'), 'test');
    
    await cleanup(tempDir);
    
    await t.throwsAsync(
        () => fs.access(tempDir),
        { code: 'ENOENT' }
    );
});

test('main function handles missing URL', async t => {
    process.argv = ['node', 'index.js'];
    cli.input = [];
    
    await t.throwsAsync(
        main,
        { message: 'Repository URL is required' }
    );
});