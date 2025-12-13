import { Ripgrep } from "../file/ripgrep"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { Config } from "../config/config"

import { Instance } from "../project/instance"
import { getBackgroundProcessManager } from "../shell/background"
import path from "path"
import os from "os"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_ANTHROPIC_WITHOUT_TODO from "./prompt/qwen.txt"
import PROMPT_POLARIS from "./prompt/polaris.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_ANTHROPIC_SPOOF from "./prompt/anthropic_spoof.txt"
import PROMPT_COMPACTION from "./prompt/compaction.txt"
import PROMPT_SUMMARIZE from "./prompt/summarize.txt"
import PROMPT_TITLE from "./prompt/title.txt"
import PROMPT_CODEX from "./prompt/codex.txt"
import type { Provider } from "@/provider/provider"

export namespace SystemPrompt {
  export function header(providerID: string) {
    if (providerID.includes("anthropic")) return [PROMPT_ANTHROPIC_SPOOF.trim()]
    return []
  }

  export function provider(model: Provider.Model) {
    if (model.api.id.includes("gpt-5")) return [PROMPT_CODEX]
    if (model.api.id.includes("gpt-") || model.api.id.includes("o1") || model.api.id.includes("o3"))
      return [PROMPT_BEAST]
    if (model.api.id.includes("gemini-")) return [PROMPT_GEMINI]
    if (model.api.id.includes("claude")) return [PROMPT_ANTHROPIC]
    if (model.api.id.includes("polaris-alpha")) return [PROMPT_POLARIS]
    return [PROMPT_ANTHROPIC_WITHOUT_TODO]
  }

  export async function environment() {
    const project = Instance.project
    return [
      [
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Today's date: ${new Date().toDateString()}`,
        `</env>`,
        `<files>`,
        `  ${
          project.vcs === "git"
            ? await Ripgrep.tree({
                cwd: Instance.directory,
                limit: 200,
              })
            : ""
        }`,
        `</files>`,
      ].join("\n"),
    ]
  }

  export async function backgroundProcesses(sessionID: string) {
    const manager = getBackgroundProcessManager()
    const processes = manager.listProcessesBySession(sessionID)

    const now = Date.now()
    const fiveMinutesAgo = now - 5 * 60 * 1000

    // Filter to running processes + completed/killed processes from last 5 minutes
    const relevantProcesses = processes.filter((process) => {
      if (process.status === "running") return true
      if (process.endTime && process.endTime >= fiveMinutesAgo) return true
      return false
    })

    if (relevantProcesses.length === 0) {
      return []
    }

    const formatDuration = (startTime: number, endTime: number | null) => {
      const duration = (endTime ?? now) - startTime
      const seconds = Math.floor(duration / 1000)
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      const remainingSeconds = seconds % 60
      if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
      const hours = Math.floor(minutes / 60)
      const remainingMinutes = minutes % 60
      return `${hours}h ${remainingMinutes}m`
    }

    const formatSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes}B`
      const kb = bytes / 1024
      if (kb < 1024) return `${kb.toFixed(1)}KB`
      const mb = kb / 1024
      return `${mb.toFixed(1)}MB`
    }

    const processLines = relevantProcesses.map((process) => {
      const info = process.getInfo()
      const statusAttr =
        info.status === "running"
          ? `status="running"`
          : info.status === "completed"
            ? `status="completed" exit_code="${info.exitCode}"`
            : `status="killed"`

      const outputSize = info.combined.length
      const startDate = new Date(info.startTime).toISOString()

      return [
        `  <process pid="${info.pid}" ${statusAttr} started="${startDate}">`,
        `    command: ${info.command}`,
        `    workdir: ${info.workdir}`,
        `    runtime: ${formatDuration(info.startTime, info.endTime)}`,
        `    output_size: ${formatSize(outputSize)}`,
        `  </process>`,
      ].join("\n")
    })

    return [["<background_processes>", ...processLines, "</background_processes>"].join("\n")]
  }

  const LOCAL_RULE_FILES = [
    "AGENTS.md",
    "CLAUDE.md",
    "CONTEXT.md", // deprecated
  ]
  const GLOBAL_RULE_FILES = [
    path.join(Global.Path.config, "AGENTS.md"),
    path.join(os.homedir(), ".claude", "CLAUDE.md"),
  ]

  export async function custom() {
    const config = await Config.get()
    const paths = new Set<string>()

    for (const localRuleFile of LOCAL_RULE_FILES) {
      const matches = await Filesystem.findUp(localRuleFile, Instance.directory, Instance.worktree)
      if (matches.length > 0) {
        matches.forEach((path) => paths.add(path))
        break
      }
    }

    for (const globalRuleFile of GLOBAL_RULE_FILES) {
      if (await Bun.file(globalRuleFile).exists()) {
        paths.add(globalRuleFile)
        break
      }
    }

    if (config.instructions) {
      for (let instruction of config.instructions) {
        if (instruction.startsWith("~/")) {
          instruction = path.join(os.homedir(), instruction.slice(2))
        }
        let matches: string[] = []
        if (path.isAbsolute(instruction)) {
          matches = await Array.fromAsync(
            new Bun.Glob(path.basename(instruction)).scan({
              cwd: path.dirname(instruction),
              absolute: true,
              onlyFiles: true,
            }),
          ).catch(() => [])
        } else {
          matches = await Filesystem.globUp(instruction, Instance.directory, Instance.worktree).catch(() => [])
        }
        matches.forEach((path) => paths.add(path))
      }
    }

    const found = Array.from(paths).map((p) =>
      Bun.file(p)
        .text()
        .catch(() => "")
        .then((x) => "Instructions from: " + p + "\n" + x),
    )
    return Promise.all(found).then((result) => result.filter(Boolean))
  }

  export function compaction(providerID: string) {
    switch (providerID) {
      case "anthropic":
        return [PROMPT_ANTHROPIC_SPOOF.trim(), PROMPT_COMPACTION]
      default:
        return [PROMPT_COMPACTION]
    }
  }

  export function summarize(providerID: string) {
    switch (providerID) {
      case "anthropic":
        return [PROMPT_ANTHROPIC_SPOOF.trim(), PROMPT_SUMMARIZE]
      default:
        return [PROMPT_SUMMARIZE]
    }
  }

  export function title(providerID: string) {
    switch (providerID) {
      case "anthropic":
        return [PROMPT_ANTHROPIC_SPOOF.trim(), PROMPT_TITLE]
      default:
        return [PROMPT_TITLE]
    }
  }
}
