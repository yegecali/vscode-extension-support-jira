import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { ExtensionConfig, NewmanRunResult } from '../types';

export class NewmanService {
  constructor(
    private config: ExtensionConfig,
    private logger?: (message: string) => void
  ) {}

  async runConfiguredCollections(): Promise<NewmanRunResult[]> {
    const collections = this.resolveJsonFiles(this.config.postmanCollectionPaths);
    const environments = this.resolveJsonFiles(this.config.postmanEnvironmentPaths);

    this.log(`[NEWMAN] Colecciones encontradas: ${collections.length}`);
    collections.forEach(collection => this.log(`[NEWMAN] Collection: ${collection}`));
    this.log(`[NEWMAN] Environments encontrados: ${environments.length}`);
    environments.forEach(environment => this.log(`[NEWMAN] Environment: ${environment}`));

    if (collections.length === 0) {
      this.log('[NEWMAN] No hay colecciones configuradas o encontradas. No se ejecuta Newman.');
      return [];
    }

    const results: NewmanRunResult[] = [];
    for (const collection of collections) {
      if (environments.length === 0) {
        results.push(await this.runNewman(collection, null));
      } else {
        for (const environment of environments) {
          results.push(await this.runNewman(collection, environment));
        }
      }
    }

    return results;
  }

  private resolveJsonFiles(paths: string[]): string[] {
    const files: string[] = [];

    for (const configuredPath of paths) {
      const trimmedPath = configuredPath.trim();
      if (!trimmedPath) {
        continue;
      }

      if (!fs.existsSync(trimmedPath)) {
        this.log(`[NEWMAN] Ruta no existe: ${trimmedPath}`);
        continue;
      }

      const stat = fs.statSync(trimmedPath);
      if (stat.isFile() && trimmedPath.endsWith('.json')) {
        files.push(trimmedPath);
      } else if (stat.isDirectory()) {
        files.push(...this.findJsonFiles(trimmedPath));
      }
    }

    return Array.from(new Set(files)).sort();
  }

  private findJsonFiles(directory: string): string[] {
    const files: string[] = [];
    const entries = fs.readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.findJsonFiles(entryPath));
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(entryPath);
      }
    }

    return files;
  }

  private runNewman(collection: string, environment: string | null): Promise<NewmanRunResult> {
    const args = ['run', collection];
    if (environment) {
      args.push('--environment', environment);
    }

    const command = [this.config.newmanCommand, ...args].join(' ');
    this.log(`[NEWMAN] Ejecutando: ${command}`);

    return new Promise(resolve => {
      execFile(
        this.config.newmanCommand,
        args,
        {
          timeout: this.config.newmanTimeoutMs,
          maxBuffer: 1024 * 1024 * 5,
        },
        (error, stdout, stderr) => {
          const exitCode = typeof error?.code === 'number' ? error.code : error ? null : 0;
          const result: NewmanRunResult = {
            collection,
            environment,
            command,
            exitCode,
            stdout,
            stderr,
            error: error ? error.message : null,
          };

          this.log(`[NEWMAN] Finalizado: ${command} exitCode=${exitCode ?? 'unknown'}`);
          this.log(`[NEWMAN] stdout=${stdout.length} caracteres, stderr=${stderr.length} caracteres`);
          resolve(result);
        }
      );
    });
  }

  private log(message: string): void {
    this.logger?.(message);
  }
}
