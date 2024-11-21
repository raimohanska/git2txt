import test from 'ava';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import the functions to test
import {
    validateInput,
    processFiles,
    writeOutput,
    cleanup
} from '../index.js';

// Helper function to create test file and verify its existence
async function createTestFile(filepath, content) {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, content);
    // Verify file exists
    const exists = await fs.access(filepath).then(() => true).catch(() => false);
    if (!exists) {
        throw new Error(`Failed to create test file: ${filepath}`);
    }
    return exists;
}

// Setup test environment
test.beforeEach(async t => {
    const tempDir = path.join(os.tmpdir(), `git2txt-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    t.context.tempDir = tempDir;
});

// Test validateInput function
test('validateInput throws error on empty input', async t => {
    const error = await t.throwsAsync(async () => {
        await validateInput([]);
    });
    t.is(error.message, 'Repository URL is required');
});

test('validateInput throws error on non-GitHub URL', async t => {
    const error = await t.throwsAsync(async () => {
        await validateInput(['https://gitlab.com/user/repo']);
    });
    t.is(error.message, 'Only GitHub repositories are supported');
});

test('validateInput returns valid GitHub URL', async t => {
    const url = 'https://github.com/octocat/Spoon-Knife';
    const result = await validateInput([url]);
    t.is(result, url);
});

// Test processFiles function
test('processFiles processes repository files', async t => {
    try {
        // Create test directory and files
        const testDir = path.join(t.context.tempDir, 'test-repo');
        const testFile1 = path.join(testDir, 'test1.txt');
        const testFile2 = path.join(testDir, 'test2.txt');
        
        // Create files and verify they exist
        await createTestFile(testFile1, 'Test content 1');
        await createTestFile(testFile2, 'Test content 2');
        
        // List directory contents for debugging
        const files = await fs.readdir(testDir);
        console.log('Test directory contents:', files);
        
        // Process files
        const output = await processFiles(testDir, {
            threshold: 1,
            includeAll: true
        });
        
        // Debug output
        console.log('Process output:', output);
        
        // Verify output
        t.true(output.includes('Test content 1'), 'Output should contain content from test1.txt');
        t.true(output.includes('Test content 2'), 'Output should contain content from test2.txt');
        
        // Clean up
        await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
        console.error('Test error:', error);
        throw error;
    }
});

// Test writeOutput function
test('writeOutput writes content to file', async t => {
    const outputPath = path.join(t.context.tempDir, 'output.txt');
    const content = 'Test content';
    
    await writeOutput(content, outputPath);
    
    const fileContent = await fs.readFile(outputPath, 'utf8');
    t.is(fileContent, content);
    
    await fs.rm(outputPath);
});

// Test cleanup function
test('cleanup removes temporary directory', async t => {
    const tempDir = path.join(t.context.tempDir, 'cleanup-test');
    await createTestFile(path.join(tempDir, 'test.txt'), 'test');
    
    await cleanup(tempDir);
    
    const exists = await fs.access(tempDir).then(() => true).catch(() => false);
    t.false(exists);
});

// Integration test
test('Basic workflow integration test', async t => {
    try {
        // Create mock repository
        const mockRepoDir = path.join(t.context.tempDir, 'mock-repo');
        const testFile = path.join(mockRepoDir, 'test.txt');
        const testContent = 'Test content';
        
        // Create test file and verify it exists
        await createTestFile(testFile, testContent);
        
        // List directory contents for debugging
        const files = await fs.readdir(mockRepoDir);
        console.log('Mock repo contents:', files);
        
        // Process files
        const content = await processFiles(mockRepoDir, {
            threshold: 1,
            includeAll: true
        });
        
        // Debug output
        console.log('Integration test content:', content);
        
        // Write output
        const outputPath = path.join(t.context.tempDir, 'output.txt');
        await writeOutput(content, outputPath);
        
        // Verify output
        const fileContent = await fs.readFile(outputPath, 'utf8');
        t.true(fileContent.includes(testContent), 'Output file should contain test content');
        
        // Clean up
        await cleanup(mockRepoDir);
        await fs.rm(outputPath);
    } catch (error) {
        console.error('Integration test error:', error);
        throw error;
    }
});
