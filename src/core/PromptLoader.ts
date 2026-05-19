import * as fs from 'fs';
import * as path from 'path';
import { MarkdownPrompt, MarkdownFrontmatter } from '../types';

export class PromptLoader {
  loadPromptsFromDirectory(dir: string): MarkdownPrompt[] {
    if (!dir || !dir.trim()) {
      return [];
    }

    try {
      if (!fs.existsSync(dir)) {
        return [];
      }

      const files = fs.readdirSync(dir).filter(file => file.endsWith('.md'));
      const prompts: MarkdownPrompt[] = [];

      for (const file of files) {
        try {
          const filePath = path.join(dir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const { frontmatter, body } = this.parseFrontmatter(content);

          if (
            frontmatter.id &&
            frontmatter.label &&
            frontmatter.classification
          ) {
            prompts.push({
              frontmatter,
              body,
              filePath,
            });
          }
        } catch (error) {
          // Ignorar archivo específico sin detener el resto
        }
      }

      return prompts;
    } catch (error) {
      return [];
    }
  }

  private parseFrontmatter(content: string): {
    frontmatter: MarkdownFrontmatter;
    body: string;
  } {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);

    if (!match) {
      return {
        frontmatter: {
          id: '',
          label: '',
          classification: '',
        },
        body: content,
      };
    }

    const [, yamlContent, body] = match;
    const frontmatter = this.parseFrontmatterFields(yamlContent);

    return {
      frontmatter,
      body: body.trim(),
    };
  }

  private parseFrontmatterFields(yaml: string): MarkdownFrontmatter {
    const result: MarkdownFrontmatter = {
      id: '',
      label: '',
      classification: '',
    };

    const lines = yaml.split('\n');
    for (const line of lines) {
      const fieldMatch = line.match(/^(\w+):\s*(.*)$/);
      if (fieldMatch) {
        const [, key, value] = fieldMatch;
        const trimmedValue = value.trim();

        if (key === 'id') {
          result.id = trimmedValue;
        } else if (key === 'label') {
          result.label = trimmedValue;
        } else if (key === 'classification') {
          result.classification = trimmedValue;
        }
      }
    }

    return result;
  }
}
