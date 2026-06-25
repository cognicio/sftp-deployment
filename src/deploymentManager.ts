import * as vscode from 'vscode';
import { Client } from 'ssh2';
import { createTargetConnection } from './connectionFactory';

export class DeploymentManager {
    private activeTargets: Map<string, string> = new Map(); 
    private connectionPool: Map<string, Client> = new Map(); 

    async switchTarget(workspaceRoot: string, config: any) {
        const targets = Object.keys(config.targets);
        const selected = await vscode.window.showQuickPick(targets, { placeHolder: 'Select active deployment target' });

        if (selected) {
            this.activeTargets.set(workspaceRoot, selected);
            if (this.connectionPool.has(selected)) {
                this.connectionPool.get(selected)?.end();
                this.connectionPool.delete(selected);
            }
        }
    }

    async getActiveConnection(workspaceRoot: string, config: any): Promise<Client> {
        const activeTargetName = this.activeTargets.get(workspaceRoot) || config.defaultTarget;
        const targetConfig = config.targets[activeTargetName];

        if (!this.connectionPool.has(activeTargetName)) {
            const conn = await createTargetConnection(targetConfig);
            this.connectionPool.set(activeTargetName, conn);
            conn.on('close', () => this.connectionPool.delete(activeTargetName));
        }

        return this.connectionPool.get(activeTargetName)!;
    }
}