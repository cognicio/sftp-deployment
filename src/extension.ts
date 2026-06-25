import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DeploymentManager } from './deploymentManager';

const deploymentManager = new DeploymentManager();

export function activate(context: vscode.ExtensionContext) {
    
    // Command to switch deployment targets manually
    let switchTargetCmd = vscode.commands.registerCommand('sftp.switchTarget', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!workspaceRoot) return;
        
        const config = loadConfigFile(workspaceRoot);
        if (config) {
            await deploymentManager.switchTarget(workspaceRoot, config);
        }
    });

    // Manual Upload Context Menu Command
    let uploadFileCmd = vscode.commands.registerCommand('sftp.uploadFile', async (uri: vscode.Uri) => {
        const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
        if (!fileUri) return;
        await executeUploadPipeline(fileUri);
    });

    // "Upload on Save" event handler
    let saveListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
        const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
        if (!workspaceRoot) return;

        const config = loadConfigFile(workspaceRoot);
        if (!config || !config.uploadOnSave) return;

        await executeUploadPipeline(document.uri);
    });

    context.subscriptions.push(switchTargetCmd, uploadFileCmd, saveListener);
}

/**
 * Orchestrates the full upload progress notification pipeline
 */
async function executeUploadPipeline(fileUri: vscode.Uri) {
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(fileUri)?.uri.fsPath;
    if (!workspaceRoot) return;

    const config = loadConfigFile(workspaceRoot);
    if (!config) return;

    const fileName = path.basename(fileUri.fsPath);

    // Utilize VS Code's native Progress API for loading notice feedback
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Deploying ${fileName}...`,
        cancellable: false
    }, async (progress) => {
        try {
            // Establish/fetch connection
            const client = await deploymentManager.getActiveConnection(workspaceRoot, config);
            
            // Initialize the SFTP subsystem stream from the SSH Client
            const sftp = await new Promise<any>((resolve, reject) => {
                client.sftp((err, sftpInstance) => {
                    if (err) {
                        reject(err); 
                    } else { 
                        resolve(sftpInstance);
                    }
                });
            });

            // Calculate the relative path from workspace to build the remote path mapping
            const relativePath = path.relative(workspaceRoot, fileUri.fsPath).replace(/\\/g, '/');
            const activeTargetName = deploymentManager['activeTargets'].get(workspaceRoot) || config.defaultTarget;
            const targetConfig = config.targets[activeTargetName];
            const remoteFilePath = path.posix.join(targetConfig.remotePath, relativePath);

            // Ensure remote directory structures exist before processing writes
            const remoteDir = path.posix.dirname(remoteFilePath);
            await new Promise<void>((resolve) => {
                sftp.mkdir(remoteDir, { mode: '0755' }, () => {
                    // Ignore errors if directory already exists
                    resolve();
                });
            });

            // Stream upload payload using SFTP fastPut
            await new Promise<void>((resolve, reject) => {
                sftp.fastPut(fileUri.fsPath, remoteFilePath, {}, (err: any) => {
                    if (err) reject(err);
                    else resolve();
                });
            });

            // SUCCESS NOTICE: Display clean feedback inside the status bar
            vscode.window.setStatusBarMessage(`✅ SFTP: ${fileName} successfully deployed to ${activeTargetName}.`, 5000);

        } catch (err: any) {
            // FAILURE NOTICE: Pop up a permanent high-priority error warning box
            vscode.window.showErrorMessage(`❌ SFTP Deployment Failed [${fileName}]: ${err.message}`);
            throw err; // Propagate up to clear progress window cleanly
        }
    });
}

function loadConfigFile(workspaceRoot: string): any {
    const configPath = path.join(workspaceRoot, '.vscode', 'sftp.json');
    if (!fs.existsSync(configPath)) return null;
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function deactivate() {}