"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Loader2,
  AlertCircle,
  Building2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  get1PasswordAccounts,
  get1PasswordAccountDetails,
  addTrackedCredentials,
} from "@/lib/api";
import type {
  AccountSummary,
  AccountDetails,
  TrackedCredentialInput,
} from "@/lib/credential-types";

export default function AddCredentialsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [accountDetails, setAccountDetails] = useState<AccountDetails | null>(null);
  const [selectedCredentials, setSelectedCredentials] = useState<Set<string>>(new Set());
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load accounts on mount
  useEffect(() => {
    loadAccounts();
  }, []);

  // Load account details when selection changes
  useEffect(() => {
    if (selectedAccount) {
      loadAccountDetails(selectedAccount);
    } else {
      setAccountDetails(null);
      setSelectedCredentials(new Set());
    }
  }, [selectedAccount]);

  const loadAccounts = async () => {
    setLoadingAccounts(true);
    setError(null);
    try {
      const data = await get1PasswordAccounts();
      setAccounts(data.filter((a) => !a.error));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoadingAccounts(false);
    }
  };

  const loadAccountDetails = async (accountName: string) => {
    setLoadingDetails(true);
    setError(null);
    try {
      const details = await get1PasswordAccountDetails(accountName);
      setAccountDetails(details);
      // Pre-select untracked credentials
      const untracked = details.credentials
        .filter((c) => !c.tracked)
        .map((c) => c.name);
      setSelectedCredentials(new Set(untracked));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load account details");
    } finally {
      setLoadingDetails(false);
    }
  };

  const toggleCredential = (name: string, isTracked: boolean) => {
    if (isTracked) return; // Can't toggle already tracked credentials

    setSelectedCredentials((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (!accountDetails) return;
    const untracked = accountDetails.credentials
      .filter((c) => !c.tracked)
      .map((c) => c.name);
    setSelectedCredentials(new Set(untracked));
  };

  const selectNone = () => {
    setSelectedCredentials(new Set());
  };

  const handleSubmit = async () => {
    if (!accountDetails || selectedCredentials.size === 0) return;

    setSubmitting(true);
    setError(null);

    try {
      // Build credential inputs with itemId and fieldLabel from account details
      const credentials: TrackedCredentialInput[] = Array.from(selectedCredentials).map(
        (credName) => {
          const credInfo = accountDetails.credentials.find(c => c.name === credName);
          return {
            account_name: accountDetails.account,
            vault_id: accountDetails.vaultId,
            vault_name: accountDetails.vaultName,
            credential_name: credName,
            item_id: credInfo?.itemId || "",
            field_label: credInfo?.fieldLabel || "",
          };
        }
      );

      await addTrackedCredentials(credentials);
      router.push("/credentials");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add credentials");
    } finally {
      setSubmitting(false);
    }
  };

  const untrackedCount = accountDetails?.credentials.filter((c) => !c.tracked).length ?? 0;
  const selectedCount = selectedCredentials.size;

  return (
    <div className="h-screen flex flex-col bg-black text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between h-11 px-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/credentials")}
            className="p-1.5 -ml-1.5 rounded hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-zinc-400" />
          </button>
          <span className="text-[13px] font-medium text-zinc-100">Add Credentials</span>
          <span className="text-zinc-600">/</span>
          <span className="text-[12px] text-zinc-500">
            Select from 1Password
          </span>
        </div>
      </header>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3 max-w-xl">
          {/* Account selector */}
          <div className="space-y-1.5 mb-4">
            <label className="text-[11px] text-zinc-500 uppercase tracking-wider">
              Account
            </label>
            <Select
              value={selectedAccount}
              onValueChange={setSelectedAccount}
              disabled={loadingAccounts}
            >
              <SelectTrigger className="h-8 text-[12px] bg-zinc-900 border-zinc-800 text-zinc-200 focus:ring-zinc-700 focus:border-zinc-700">
                <SelectValue placeholder={loadingAccounts ? "Loading accounts..." : "Select account"} />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800">
                {accounts.map((account) => (
                  <SelectItem
                    key={account.name}
                    value={account.name}
                    className="text-[12px] text-zinc-200 focus:bg-zinc-800 focus:text-zinc-100"
                  >
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3.5 h-3.5 text-zinc-500" />
                      <span>{account.name}</span>
                      <span className="text-[11px] text-zinc-600">
                        ({account.credentialCount})
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Credentials list */}
          {selectedAccount && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-zinc-500 uppercase tracking-wider">
                  Credentials
                </label>
                {accountDetails && untrackedCount > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={selectAll}
                      className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                    >
                      Select all
                    </button>
                    <span className="text-zinc-700">|</span>
                    <button
                      onClick={selectNone}
                      className="text-[11px] text-zinc-500 hover:text-zinc-400 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded border border-zinc-800 bg-zinc-900/30 overflow-hidden">
                {loadingDetails ? (
                  <div className="flex items-center justify-center py-12 text-zinc-500">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    <span className="text-[12px]">Loading credentials...</span>
                  </div>
                ) : accountDetails?.credentials.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                    <AlertCircle className="w-4 h-4 mb-2" />
                    <span className="text-[12px]">No credentials found</span>
                  </div>
                ) : (
                  <div className="max-h-[360px] overflow-y-auto">
                    {accountDetails?.credentials.map((cred, idx) => {
                      const isSelected = selectedCredentials.has(cred.name);
                      const isTracked = cred.tracked;

                      return (
                        <button
                          key={cred.name}
                          onClick={() => toggleCredential(cred.name, isTracked)}
                          disabled={isTracked}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                            idx !== (accountDetails?.credentials.length ?? 0) - 1
                              ? "border-b border-zinc-800/30"
                              : ""
                          } ${
                            isTracked
                              ? "opacity-50 cursor-not-allowed"
                              : isSelected
                              ? "bg-zinc-800/30"
                              : "hover:bg-zinc-800/20"
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                              isTracked
                                ? "bg-zinc-700 border-zinc-600"
                                : isSelected
                                ? "bg-zinc-600 border-zinc-500"
                                : "border-zinc-600"
                            }`}
                          >
                            {(isSelected || isTracked) && (
                              <Check className="w-3 h-3 text-zinc-200" />
                            )}
                          </div>
                          <span
                            className={`text-[12px] flex-1 truncate ${
                              isTracked
                                ? "text-zinc-600"
                                : isSelected
                                ? "text-zinc-200"
                                : "text-zinc-400"
                            }`}
                          >
                            {cred.name}
                          </span>
                          {isTracked && (
                            <span className="text-[10px] text-zinc-600">
                              Already tracked
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 mt-4 p-2 rounded border border-red-500/20 bg-red-500/5 text-red-400 text-[12px]">
              <X className="w-3.5 h-3.5 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-zinc-800 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => router.push("/credentials")}
          className="h-8 px-3 text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={selectedCount === 0 || submitting}
          className="h-8 px-3 text-[12px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
              Adding...
            </>
          ) : (
            <>
              Add {selectedCount > 0 ? selectedCount : ""} Credential
              {selectedCount !== 1 ? "s" : ""}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
