---
name: file_manager
description: Professional file operations with backup, search, and batch processing
version: 1.0.0
triggers: file, read, write, edit, delete, backup, search, find
---

# File Manager Skill

This skill provides advanced file operations beyond basic read/write.

## When to Use

Use these tools when the user wants to:
- Read, write, or edit files
- Search for files by name or content
- Backup files before modification
- Batch process multiple files
- Get file information

## Tools

### read_file
Read file content with optional line range.
```bash
TOOL fs.read_file {"path": "./src/index.ts", "start": 1, "end": 50}
```

### write_file
Write content to a file. Always backup first!
```bash
TOOL fs.write_file {"path": "./output.txt", "content": "Hello world"}
```

### search_in_files
Search for text patterns in files.
```bash
TOOL shell.exec {"command": "grep -r 'pattern' --include='*.ts' ."}
```

## Best Practices

1. **Backup before write**: Always create a backup copy before modifying important files
2. **Verify after write**: Read back to confirm the write was successful
3. **Use relative paths**: Prefer relative paths from the project root
4. **Check file size**: Don't try to read very large files (>1MB) at once
5. **Handle errors gracefully**: Check if file exists before operations

## Examples

### Backup and Edit
```
THINK: User wants to modify config file. I should backup first.
TOOL shell.exec {"command": "cp config.json config.json.backup"}
TOOL fs.read_file {"path": "config.json"}
TOOL fs.write_file {"path": "config.json", "content": "new content"}
```

### Search Project
```
TOOL shell.exec {"command": "grep -r 'TODO' --include='*.ts' src/ | head -20"}
```