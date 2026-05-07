---
name: code_developer
description: Write, test, debug, and improve code in multiple languages
version: 1.0.0
triggers: code, write, implement, debug, test, fix, refactor, create
---

# Code Developer Skill

Professional software development capabilities.

## When to Use

- Write new code or features
- Debug and fix issues
- Run tests and verify fixes
- Refactor existing code
- Create complete applications

## Tools

### code.exec
Execute code in various languages.
```bash
TOOL code.exec {"language": "javascript", "code": "console.log('Hello')"}
```

### code.generator
Generate code from description.
```bash
TOOL code.generator {"task": "create a function to calculate fibonacci", "language": "typescript"}
```

### shell.exec
Run shell commands (git, npm, etc).
```bash
TOOL shell.exec {"command": "npm test"}
```

## Development Workflow

1. **Understand requirements**: Clarify what needs to be built
2. **Plan structure**: Decide on files and modules
3. **Implement**: Write the code
4. **Test**: Run tests and fix issues
5. **Verify**: Ensure it works as expected
6. **Document**: Add comments if needed

## Best Practices

### Before Writing
- Read existing code in the project
- Check coding style conventions
- Look for related tests

### While Writing
- Follow project conventions
- Add error handling
- Write readable, maintainable code
- Include necessary imports

### After Writing
- Run tests to verify
- Check for linting errors
- Verify the code works

## Examples

### Create a simple script
```
THINK: User wants a script. I'll create it and run it.
TOOL fs.write_file {"path": "hello.js", "content": "console.log('Hello World');"}
TOOL code.exec {"language": "javascript", "code": ""}
TOOL shell.exec {"command": "node hello.js"}
```

### Fix a bug
```
THINK: There's a bug in the function. First let me read the file.
TOOL fs.read_file {"path": "src/utils.ts"}
THINK: I see the issue - missing null check. Let me fix it.
TOOL fs.write_file {"path": "src/utils.ts", "content": "..."}
TOOL shell.exec {"command": "npm test"}
```

### Create a full project
```
THINK: User wants a todo app. I'll create the structure.
TOOL shell.exec {"command": "mkdir -p src components"}
TOOL fs.write_file {"path": "src/index.html", "content": "..."}
TOOL shell.exec {"command": "npm install && npm run build"}
```