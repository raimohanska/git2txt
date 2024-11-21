# git2txt

Convert GitHub repositories to text files with ease. This CLI tool downloads a repository and concatenates its contents into a single text file, making it perfect for analysis, documentation, or AI training purposes.

## Features

- 📥 Download any public GitHub repository
- 📝 Convert repository contents to a single text file
- ⚡ Automatic binary file exclusion
- 🔧 Configurable file size threshold
- 💻 Cross-platform support (Windows, macOS, Linux)

## Installation

```bash
npm install -g git2txt-cli
```

## Usage

Basic usage:
```bash
git2txt <repository-url>
```

Example:
```bash
git2txt https://github.com/username/repository
```

### Options

```
--output, -o     Specify output file path (default: repo-name.txt)
--threshold, -t  Set file size threshold in MB (default: 0.5)
--include-all    Include all files regardless of size or type
--help          Show help
--version       Show version
```

### Examples

Download and convert a repository with default settings:
```bash
git2txt https://github.com/username/repository
```

Specify custom output file:
```bash
git2txt https://github.com/username/repository --output=output.txt
```

Set custom file size threshold (2MB):
```bash
git2txt https://github.com/username/repository --threshold=2
```

Include all files:
```bash
git2txt https://github.com/username/repository --include-all
```

## Default Behavior

- Files larger than 500KB are excluded by default
- Binary files are automatically excluded
- The output file is created in the current directory
- File paths and contents are separated by clear markers

## Contributing

Contributions are welcome! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT
