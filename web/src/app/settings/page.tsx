"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Settings,
  Github,
  Bot,
  Eye,
  EyeOff,
  Loader2,
  Check,
  X,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getGitHubPat,
  setGitHubPat,
  getCommitMessageModel,
  setCommitMessageModel,
  testGitHubConnection,
  getAvailableModels,
  type GitHubStatus,
  type AIModel,
} from "@/lib/api";

export default function SettingsPage() {
  const router = useRouter();

  // GitHub settings
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [patSaved, setPatSaved] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<GitHubStatus | null>(null);

  // AI model settings
  const [models, setModels] = useState<AIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loadingModels, setLoadingModels] = useState(true);

  // Load settings on mount
  useEffect(() => {
    const storedPat = getGitHubPat();
    setPat(storedPat);

    const storedModel = getCommitMessageModel();
    setSelectedModel(storedModel);

    // Load available models
    async function loadModels() {
      try {
        const availableModels = await getAvailableModels();
        setModels(availableModels);
      } finally {
        setLoadingModels(false);
      }
    }
    loadModels();

    // Auto-test connection if PAT is configured
    if (storedPat) {
      handleTestConnection();
    }
  }, []);

  // Handle PAT change
  const handlePatChange = (value: string) => {
    setPat(value);
    setPatSaved(false);
    setConnectionStatus(null);
  };

  // Save PAT
  const handleSavePat = () => {
    setGitHubPat(pat);
    setPatSaved(true);
    if (pat) {
      handleTestConnection();
    } else {
      setConnectionStatus(null);
    }
  };

  // Test connection
  const handleTestConnection = async () => {
    setTestingConnection(true);
    try {
      const status = await testGitHubConnection();
      setConnectionStatus(status);
    } catch {
      setConnectionStatus({ connected: false, error: "Connection test failed" });
    } finally {
      setTestingConnection(false);
    }
  };

  // Handle model change
  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    setCommitMessageModel(model);
  };

  return (
    <div className="h-screen flex flex-col bg-black text-zinc-100">
      {/* Header */}
      <header className="flex items-center h-12 px-4 border-b border-zinc-800 flex-shrink-0">
        <button
          onClick={() => router.push("/")}
          className="p-1.5 -ml-1.5 rounded hover:bg-zinc-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-zinc-400" />
        </button>
        <Settings className="w-4 h-4 text-zinc-400 ml-2" />
        <span className="text-[13px] font-medium text-zinc-100 ml-2">Settings</span>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-2xl mx-auto space-y-8">
          {/* GitHub Settings */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Github className="w-5 h-5 text-zinc-400" />
              <h2 className="text-[14px] font-medium text-zinc-100">GitHub Integration</h2>
            </div>

            <div className="space-y-4 bg-zinc-900/50 rounded-lg border border-zinc-800 p-4">
              {/* PAT input */}
              <div>
                <label className="text-[11px] text-zinc-500 mb-1.5 block">
                  Personal Access Token
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={showPat ? "text" : "password"}
                      value={pat}
                      onChange={(e) => handlePatChange(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                      className="h-9 text-[12px] bg-zinc-800 border-zinc-700 text-zinc-200 pr-10 font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPat(!showPat)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-300"
                    >
                      {showPat ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <button
                    onClick={handleSavePat}
                    disabled={patSaved && pat === getGitHubPat()}
                    className="h-9 px-4 text-[12px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save
                  </button>
                </div>
                <p className="text-[10px] text-zinc-600 mt-1.5">
                  Create a{" "}
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline inline-flex items-center gap-0.5"
                  >
                    Personal Access Token
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {" "}with repo access.
                </p>
              </div>

              {/* Connection status */}
              {connectionStatus && (
                <div
                  className={`flex items-start gap-2 p-3 rounded ${
                    connectionStatus.connected
                      ? "bg-green-500/10 border border-green-500/30"
                      : "bg-red-500/10 border border-red-500/30"
                  }`}
                >
                  {connectionStatus.connected ? (
                    <>
                      <Check className="w-4 h-4 text-green-400 mt-0.5" />
                      <div>
                        <p className="text-[12px] text-green-400">Connected as @{connectionStatus.user}</p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          {connectionStatus.hasRepoAccess
                            ? `Access to ${connectionStatus.repo}`
                            : "No access to repository"}
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5" />
                      <div>
                        <p className="text-[12px] text-red-400">Connection failed</p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">{connectionStatus.error}</p>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Test connection button */}
              <button
                onClick={handleTestConnection}
                disabled={!pat || testingConnection}
                className="flex items-center gap-2 h-8 px-3 text-[12px] rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testingConnection ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Testing...
                  </>
                ) : (
                  "Test Connection"
                )}
              </button>
            </div>
          </section>

          {/* AI Model Settings */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Bot className="w-5 h-5 text-zinc-400" />
              <h2 className="text-[14px] font-medium text-zinc-100">AI Commit Messages</h2>
            </div>

            <div className="space-y-4 bg-zinc-900/50 rounded-lg border border-zinc-800 p-4">
              <div>
                <label className="text-[11px] text-zinc-500 mb-1.5 block">
                  Model for commit message generation
                </label>
                {loadingModels ? (
                  <div className="h-9 flex items-center">
                    <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
                  </div>
                ) : (
                  <Select value={selectedModel} onValueChange={handleModelChange}>
                    <SelectTrigger className="h-9 w-64 text-[12px] bg-zinc-800 border-zinc-700 text-zinc-200">
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-900 border-zinc-700">
                      {models.map((model) => (
                        <SelectItem
                          key={model.id}
                          value={model.id}
                          className="text-[12px] text-zinc-200"
                        >
                          <div className="flex items-center gap-2">
                            <span>{model.name}</span>
                            {model.default && (
                              <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-700 text-zinc-400">
                                Default
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-[10px] text-zinc-600 mt-1.5">
                  This model generates commit messages when saving context files.
                </p>
              </div>
            </div>
          </section>

          {/* Info section */}
          <section className="text-[11px] text-zinc-600 bg-zinc-900/30 rounded-lg border border-zinc-800/50 p-4">
            <p className="mb-2">
              <strong className="text-zinc-500">About Project Context Files</strong>
            </p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Context files are stored in GitHub at cloud-terminal/projects/&lt;folder&gt;/CONTEXT.md</li>
              <li>Each project folder can have one context file with documentation and notes</li>
              <li>Changes are tracked through Git commits with AI-generated messages</li>
              <li>Context files can be used to provide background information to AI assistants</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
