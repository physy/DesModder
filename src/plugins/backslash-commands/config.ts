import { ConfigItem, CustomLatexCommand } from "#plugins/index.ts";

export const configList = [
  {
    key: "customCommands",
    type: "custom-commands",
    default: [],
  },
] satisfies ConfigItem[];

export interface Config {
  customCommands: CustomLatexCommand[];
}
