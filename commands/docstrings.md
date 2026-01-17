---
description: Add docstrings to public APIs in changed files
---

# Docstrings Command

Use the envoy:docstrings skill to add documentation to public APIs.

**Default behavior:** Document files changed since main branch.

**With arguments:** Document specific files or directories.

```
/envoy:docstrings                    # Document changed files
/envoy:docstrings src/services/      # Document specific directory
/envoy:docstrings UserService.cs     # Document specific file
```

**Languages supported:**
- C#: XML documentation (`/// <summary>`)
- TypeScript/React: JSDoc comments (`/** */`)
