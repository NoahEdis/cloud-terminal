"use client";

import { useState, useEffect } from "react";
import { X, Loader2, Save } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateSyncConfig } from "@/lib/api";
import type { SyncSource, SyncSourceConfig } from "@/lib/sync-types";
import { getSourceMeta, SYNC_SOURCE_META } from "@/lib/sync-types";

interface SyncConfigModalProps {
  source: SyncSource | null;
  onClose: () => void;
  onSave: () => void;
}

const SCHEDULE_OPTIONS = [
  { label: "Manual only", value: "" },
  { label: "Every 5 minutes", value: "*/5 * * * *" },
  { label: "Every 15 minutes", value: "*/15 * * * *" },
  { label: "Every 30 minutes", value: "*/30 * * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
];

export function SyncConfigModal({
  source,
  onClose,
  onSave,
}: SyncConfigModalProps) {
  const [enabled, setEnabled] = useState(true);
  const [schedule, setSchedule] = useState("");
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = source ? getSourceMeta(source.source) : null;
  const configFields = meta
    ? SYNC_SOURCE_META[source!.source]?.configFields || []
    : [];

  // Initialize state from source
  useEffect(() => {
    if (source) {
      setEnabled(source.enabled);
      setSchedule(source.schedule || "");
      setOptions(source.options || {});
    }
  }, [source]);

  const handleSave = async () => {
    if (!source) return;

    setSaving(true);
    setError(null);

    try {
      const config: SyncSourceConfig = {
        enabled,
        schedule: schedule || null,
        options,
      };

      await updateSyncConfig(source.source, config);
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  const handleOptionChange = (key: string, value: unknown) => {
    setOptions((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  if (!source || !meta) {
    return null;
  }

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-zinc-100 max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[14px] font-medium">
            Configure {meta.displayName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Enable/Disable */}
          <div className="flex items-center justify-between py-2">
            <div>
              <div className="text-[12px] font-medium text-zinc-200">Enabled</div>
              <div className="text-[11px] text-zinc-500">
                Allow this sync to run
              </div>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              className="data-[state=checked]:bg-blue-600"
            />
          </div>

          {/* Schedule */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-zinc-200">
              Schedule
            </label>
            <Select value={schedule} onValueChange={setSchedule}>
              <SelectTrigger className="h-9 bg-zinc-800 border-zinc-700 text-[12px]">
                <SelectValue placeholder="Select schedule" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-700">
                {SCHEDULE_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="text-[12px] text-zinc-200"
                  >
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-zinc-500">
              {meta.supportsWebhook
                ? "This source also receives real-time updates via webhook"
                : "Scheduled syncs run at the specified interval"}
            </p>
          </div>

          {/* Source-specific options */}
          {configFields.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-zinc-800">
              <div className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                Options
              </div>

              {configFields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <label className="text-[12px] font-medium text-zinc-200">
                    {field.label}
                  </label>

                  {field.type === "number" && (
                    <Input
                      type="number"
                      value={(options[field.key] as number) ?? field.default ?? ""}
                      onChange={(e) =>
                        handleOptionChange(
                          field.key,
                          e.target.value ? parseInt(e.target.value, 10) : null
                        )
                      }
                      className="h-9 bg-zinc-800 border-zinc-700 text-[12px]"
                    />
                  )}

                  {field.type === "string" && (
                    <Input
                      type="text"
                      value={(options[field.key] as string) ?? field.default ?? ""}
                      onChange={(e) => handleOptionChange(field.key, e.target.value)}
                      className="h-9 bg-zinc-800 border-zinc-700 text-[12px]"
                      placeholder={field.description}
                    />
                  )}

                  {field.type === "boolean" && (
                    <Switch
                      checked={(options[field.key] as boolean) ?? field.default ?? false}
                      onCheckedChange={(checked) =>
                        handleOptionChange(field.key, checked)
                      }
                      className="data-[state=checked]:bg-blue-600"
                    />
                  )}

                  {field.type === "select" && field.options && (
                    <Select
                      value={(options[field.key] as string) ?? (field.default as string) ?? ""}
                      onValueChange={(val) => handleOptionChange(field.key, val)}
                    >
                      <SelectTrigger className="h-9 bg-zinc-800 border-zinc-700 text-[12px]">
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-800 border-zinc-700">
                        {field.options.map((opt) => (
                          <SelectItem
                            key={opt.value}
                            value={opt.value}
                            className="text-[12px] text-zinc-200"
                          >
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {field.description && (
                    <p className="text-[10px] text-zinc-500">{field.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-2 rounded bg-red-500/10 border border-red-500/20">
              <p className="text-[11px] text-red-400">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-[12px] rounded border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Save className="w-3 h-3" />
              )}
              Save
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
