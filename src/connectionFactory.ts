import { Client } from 'ssh2';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

function resolveHomePath(inputPath: string): string {
    return inputPath.startsWith('~') ? path.join(os.homedir(), inputPath.slice(1)) : inputPath;
}

// Securely resolves plain-text strings or interactive user inputs for private key decryption
async function resolvePassphrase(passphraseConfig: any, username: string, host: string): Promise<string | undefined> {
    if (typeof passphraseConfig === 'string') {
        return passphraseConfig;
    }

    if (passphraseConfig === true) {
        const passphrase = await vscode.window.showInputBox({
            prompt: `Enter private key passphrase for ${username}@${host}`,
            placeHolder: "Passphrase",
            password: true,
            ignoreFocusOut: true
        });

        if (passphrase === undefined) {
            throw new Error(`Deployment cancelled: Passphrase not provided for ${username}@${host}`);
        }
        return passphrase;
    }

    return undefined;
}

export async function createTargetConnection(targetConfig: any): Promise<Client> {
    const destinationConn = new Client();

    // 1. Prepare Target Destination credentials
    if (!targetConfig.privateKeyPath) {
        throw new Error('Destination configuration missing "privateKeyPath".');
    }
    const destKeyPath = resolveHomePath(targetConfig.privateKeyPath);
    const destKeyBuffer = fs.readFileSync(destKeyPath);
    const destPassphrase = await resolvePassphrase(targetConfig.passphrase, targetConfig.username, targetConfig.host);

    const destAuthOptions: any = {
        username: targetConfig.username,
        privateKey: destKeyBuffer,
        ...(destPassphrase && { passphrase: destPassphrase })
    };

    // 2. Select Connection Path: SSH Jump Host vs Direct Connection
    if (targetConfig.proxy && targetConfig.proxy.type === 'ssh-jump') {
        const proxyConfig = targetConfig.proxy;
        const proxyConn = new Client();

        if (!proxyConfig.privateKeyPath) {
            throw new Error('Proxy configuration missing "privateKeyPath".');
        }
        const proxyKeyPath = resolveHomePath(proxyConfig.privateKeyPath);
        const proxyKeyBuffer = fs.readFileSync(proxyKeyPath);
        const proxyPassphrase = await resolvePassphrase(proxyConfig.passphrase, proxyConfig.username, proxyConfig.host);

        const proxyAuthOptions = {
            username: proxyConfig.username,
            privateKey: proxyKeyBuffer,
            ...(proxyPassphrase && { passphrase: proxyPassphrase })
        };

        return new Promise((resolve, reject) => {
            // Step A: Secure handshake with the Bastion Host
            proxyConn.on('ready', () => {
                // Step B: Request TCP socket forwarding through the Bastion Host to the final target
                proxyConn.forwardOut(
                    '127.0.0.1', 0,
                    targetConfig.host, targetConfig.port || 22,
                    (err, stream) => {
                        if (err) {
                            proxyConn.end();
                            return reject(new Error(`Proxy tunnel forwarding failed: ${err.message}`));
                        }

                        // Step C: Route the destination server authentication straight through the forwarded stream
                        destinationConn.connect({
                            sock: stream,
                            ...destAuthOptions
                        });
                    }
                );
            });

            destinationConn.on('ready', () => {
                // Tie connection lifecycles together so closing the destination drops the proxy link
                destinationConn.on('close', () => proxyConn.end());
                resolve(destinationConn);
            });

            proxyConn.on('error', (err) => reject(new Error(`Proxy Authentication Failed: ${err.message}`)));
            destinationConn.on('error', (err) => {
                proxyConn.end();
                reject(new Error(`Destination Authentication Failed: ${err.message}`));
            });

            proxyConn.connect({
                host: proxyConfig.host,
                port: proxyConfig.port || 22,
                ...proxyAuthOptions
            });
        });

    } else {
        // Direct Connection Fallback
        return new Promise((resolve, reject) => {
            destinationConn.on('ready', () => resolve(destinationConn));
            destinationConn.on('error', (err) => reject(err));
            destinationConn.connect({
                host: targetConfig.host,
                port: targetConfig.port || 22,
                ...destAuthOptions
            });
        });
    }
}