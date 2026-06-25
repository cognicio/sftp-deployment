# JetBrains-Style SFTP Deployment
## By Cognicio Technologies

A robust, local-first SFTP deployment extension for Visual Studio Code and alternative IDE platforms. Inspired by the smooth deployment and remote-syncing models of JetBrains IDEs, this extension enables multi-target deployments, automatic syncing, and multi-tier SSH connection tunneling via an **SSH Jump Host** (Bastion) with dual private-key and passphrase authentication.

## Core Features

* **JetBrains Sync Workflow:** Manage applications locally and upload/download differential changes to remote networks.
* **Multi-Target Configuration:** Set up isolated targets (e.g., QA, Stage, Production) and change environment targets on the fly.
* **SSH Proxy Jump (Bastion Tunneling):** Forward traffic through secure server gates using unique keys and passphrases for both the proxy and the target server.
* **Flexible Passphrase Modes:** Supports storing encrypted private key passphrases directly inside your file configuration or prompting you securely via the native IDE window.
* **Upload on Save:** Automatically uploads modifications to the active destination the moment you save.

---

## Configuration (`sftp.json`)

The extension parses project rules out of a file located at `.vscode/sftp.json`.

### Multi-Tier Configuration Blueprint

Copy and tweak the framework schema below to outline your environments:

```json
{
  "defaultTarget": "staging",
  "targets": {
    "staging": {
      "host": "staging-app.internal.net",
      "port": 22,
      "username": "application-deployer",
      "privateKeyPath": "~/.ssh/id_dest_ed25519",
      "passphrase": "target-key-passphrase-here", 
      "remotePath": "/var/www/html",
      "uploadOnSave": true,
      "proxy": {
        "type": "ssh-jump",
        "host": "bastion-gate.external.com",
        "port": 22,
        "username": "bastion-admin",
        "privateKeyPath": "~/.ssh/id_proxy_rsa",
        "passphrase": true 
      }
    }
  }
}