import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DeploymentManager } from './deploymentManager';

const deploymentManager = new DeploymentManager();

export function activate(context: vscode.ExtensionContext) {
    
    // Command: Switch active target profile
    let switchTargetCmd = vscode.commands.registerCommand('sftp.switchTarget', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!workspaceRoot) return;
        
        const config = loadConfigFile(workspaceRoot);
        if (config) {
            await deploymentManager.switchTarget(workspaceRoot, config);
        }
    });

    // Command: Upload File or Directory
    let uploadCmd = vscode.commands.registerCommand('sftp.upload', async (uri: vscode.Uri) => {
        const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
        if (!targetUri) return;
        await executeSyncPipeline(targetUri, 'upload');
    });

    // Command: Download File or Directory
    let downloadCmd = vscode.commands.registerCommand('sftp.download', async (uri: vscode.Uri) => {
        const targetUri = uri || vscode.window.activeTextEditor?.document.uri;
        if (!targetUri) return;
        await executeSyncPipeline(targetUri, 'download');
    });

    // Event: Automatically Upload on File Save
    let saveListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
        if (!workspaceRoot) return;

        const config = loadConfigFile(workspaceRoot);
        if (!config || !config.uploadOnSave) return;

        await executeSyncPipeline(document.uri, 'upload');
    });

    context.subscriptions.push(switchTargetCmd, uploadCmd, downloadCmd, saveListener);
}

/**
 * Orchestrates bi-directional file and folder synchronization
 */
async function executeSyncPipeline(targetUri: vscode.Uri, operation: 'upload' | 'download') {
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(targetUri)?.uri.fsPath;
    if (!workspaceRoot) return;

    const config = loadConfigFile(workspaceRoot);
    if (!config) return;

    const targetName = path.basename(targetUri.fsPath);
    const isFolder = fs.existsSync(targetUri.fsPath) && fs.statSync(targetUri.fsPath).isDirectory();

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: operation === 'upload' ? `Uploading ${targetName}...` : `Downloading ${targetName}...`,
        cancellable: false
    }, async (progress) => {
        try {
            const client = await deploymentManager.getActiveConnection(workspaceRoot, config);
            const sftp = await new Promise<any>((resolve, reject) => {
                client.sftp((err, instance) => {
                    if (err) reject(err);
                    else resolve(instance);
                });
            });

            // Mapping path transformations
            const relativePath = path.relative(workspaceRoot, targetUri.fsPath).replace(/\\/g, '/');
            const activeTargetName = deploymentManager['activeTargets'].get(workspaceRoot) || config.defaultTarget;
            const targetConfig = config.targets[activeTargetName];
            const remotePath = path.posix.join(targetConfig.remotePath, relativePath);

            if (operation === 'upload') {
                if (isFolder) {
                    await uploadDirectoryRecursive(sftp, targetUri.fsPath, remotePath);
                } else {
                    await uploadSingleFile(sftp, targetUri.fsPath, remotePath);
                }
                vscode.window.setStatusBarMessage(`✅ SFTP: Uploaded ${targetName} to ${activeTargetName}.`, 5000);
            } else {
                if (isFolder) {
                    await downloadDirectoryRecursive(sftp, remotePath, targetUri.fsPath);
                } else {
                    await downloadSingleFile(sftp, remotePath, targetUri.fsPath);
                }
                vscode.window.setStatusBarMessage(`✅ SFTP: Downloaded ${targetName} from ${activeTargetName}.`, 5000);
            }

        } catch (err: any) {
            vscode.window.showErrorMessage(`❌ SFTP Operation Failed [${targetName}]: ${err.message}`);
            throw err;
        }
    });
}

// --- SINGLE FILE HANDLERS ---

async function uploadSingleFile(sftp: any, localPath: string, remotePath: string): Promise<void> {
    const remoteDir = path.posix.dirname(remotePath);
    await ensureRemoteDirExists(sftp, remoteDir);
    return new Promise((resolve, reject) => {
        sftp.fastPut(localPath, remotePath, {}, (err: any) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async function downloadSingleFile(sftp: any, remotePath: string, localPath: string): Promise<void> {
    const localDir = path.dirname(localPath);
    if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
    }
    return new Promise((resolve, reject) => {
        sftp.fastGet(remotePath, localPath, {}, (err: any) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// --- RECURSIVE DIRECTORY HANDLERS ---

async function uploadDirectoryRecursive(sftp: any, localDir: string, remoteDir: string): Promise<void> {
    await ensureRemoteDirExists(sftp, remoteDir);
    const items = fs.readdirSync(localDir);

    for (const item of items) {
        const localItemPath = path.join(localDir, item);
        const remoteItemPath = path.posix.join(remoteDir, item);

        if (fs.statSync(localItemPath).isDirectory()) {
            await uploadDirectoryRecursive(sftp, localItemPath, remoteItemPath);
        } else {
            await new Promise<void>((resolve, reject) => {
                sftp.fastPut(localItemPath, remoteItemPath, {}, (err: any) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
    }
}

async function downloadDirectoryRecursive(sftp: any, remoteDir: string, localDir: string): Promise<void> {
    if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
    }

    const remoteItems: any[] = await new Promise((resolve, reject) => {
        sftp.readdir(remoteDir, (err: any, list: any[]) => {
            if (err) reject(err);
            else resolve(list);
        });
    });

    for (const item of remoteItems) {
        if (item.filename === '.' || item.filename === '..') continue;

        const remoteItemPath = path.posix.join(remoteDir, item.filename);
        const localItemPath = path.join(localDir, item.filename);

        // Check if item is a directory using bitwise flags on attributes longname/attrs
        const isRemoteDirectory = (item.attrs.mode & 0o170000) === 0o040000;

        if (isRemoteDirectory) {
            await downloadDirectoryRecursive(sftp, remoteItemPath, localItemPath);
        } else {
            await new Promise<void>((resolve, reject) => {
                sftp.fastGet(remoteItemPath, localItemPath, {}, (err: any) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
    }
}

// --- UTILITY SYSTEM HELPERS ---

async function ensureRemoteDirExists(sftp: any, remoteDir: string): Promise<void> {
    const parts = remoteDir.split('/').filter(p => p);
    let current = '';
    
    // Support absolute paths starting with '/'
    if (remoteDir.startsWith('/')) current = '/';

    for (const part of parts) {
        current = path.posix.join(current, part);
        await new Promise<void>((resolve) => {
            sftp.mkdir(current, { mode: '0755' }, () => {
                // Ignore folder creation crashes if directory exists
                resolve();
            });
        });
    }
}

function loadConfigFile(workspaceRoot: string): any {
    const configPath = path.join(workspaceRoot, '.vscode', 'sftp.json');
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function deactivate() {}