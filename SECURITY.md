# Security Best Practices

## Never Commit These Files:
- Private keys (any file containing "PRIVATE KEY")
- Wallet files (id.json)
- Environment files with secrets (.env.local, .env.production)
- API keys or tokens

## If You Accidentally Commit Secrets:
1. Rotate ALL exposed keys immediately
2. Use git filter-branch to remove from history
3. Force push to remote
4. Monitor for suspicious activity

## Development Security:
- Use environment variables for secrets
- Never hardcode private keys in scripts
- Use .env.example for required variables
- Regular security audits
