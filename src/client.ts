import type { SettingsScope } from "@deepseek-ai/dsh-client-runtime/client";

import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import * as React from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import type { Context } from "@deepseek-ai/cordis";
import type { NvidiaConfig, NvidiaCatalogModel } from "./index.js";

type Translate = (key: keyof typeof en) => string;
interface FieldProps { label: string; hint?: string; children: React.ReactNode }
interface InputProps {
  value?: string | number;
  placeholder?: string;
  disabled?: boolean;
  onChange(value: string): void;
}
interface SelectProps extends InputProps { options: { value: string; label: string }[] }
interface ModelsProps {
  models: NvidiaCatalogModel[];
  t: Translate;
  disabled?: boolean;
  onChange(models: NvidiaCatalogModel[]): void;
}
interface CredentialState { configured?: boolean }
type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { message: string } };
type CredentialResponse<T> = RemoteResult<T> | { result: RemoteResult<T> };
// Older DSH packages omit the generated credentials contribution from their
// client declarations. Keep its positional Remote contract at this boundary.
interface CredentialsRemote {
  credentials: {
    describe(refs: string[]): Promise<CredentialResponse<Record<string, CredentialState>>>;
    set(ref: string, value: string): Promise<CredentialResponse<void>>;
  };
}
interface SettingsProps { scope: SettingsScope<NvidiaConfig>; api: CredentialsRemote; t: Translate }

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap { "settings.nvidia": keyof typeof en }
}

// -------------------------------------------------------------------------
// 常量
// -------------------------------------------------------------------------
const SETTINGS_NS = "llm-nvidia-completions";
const KEY_REF = "NVIDIA_API_KEY";
const NS = "settings.nvidia"; // locale 字典命名空间

const REASONING_EFFORTS = ["off", "low", "high", "max"] as const;
const MODALITIES = ["text", "image"] as const;

// -------------------------------------------------------------------------
// 文案（zh / en）
// -------------------------------------------------------------------------
const en = {
  nav: "Nvidia NIM",
  title: "Nvidia NIM",
  intro: "Configure the Nvidia NIM provider and its model catalog. Values are written to the llm-nvidia-completions section.",
  providerHeading: "Provider",
  apiKey: "API key",
  apiKeyHint: "Stored as NVIDIA_API_KEY; leave blank to keep the current key.",
  apiKeyStored: "Configured — enter a new value to replace.",
  apiKeyUnset: "Not configured.",
  baseUrl: "Base URL",
  baseUrlHint: "Leave blank to use https://integrate.api.nvidia.com/v1.",
  reasoningEffort: "Default reasoning effort",
  temperature: "Default temperature (0–2)",
  topP: "Default top_p (0–1)",
  seed: "Seed",
  maxTokens: "Default max output tokens",
  contextWindow: "Default context window",
  modelsHeading: "Models",
  modelsHint: "Each row's id is sent to the provider. Context window and max tokens fall back to the provider defaults above when left empty.",
  addModel: "Add model",
  removeModel: "Delete",
  modelId: "Model ID",
  modelName: "Display name",
  modelDescription: "Description",
  modelContextWindow: "Context window",
  modelMaxTokens: "Max output tokens",
  modelTopP: "top_p",
  modelInputModalities: "Input modalities",
  text: "text",
  image: "image",
  save: "Save",
  saving: "Saving…",
  saved: "Saved.",
  failed: "Save failed.",
  readOnly: "These settings are read-only in this deployment.",
  loading: "Loading…",
  unavailable: "The llm-nvidia-completions settings section is unavailable.",
  numberInvalid: "Please enter a valid number."
};

const zh = {
  nav: "Nvidia NIM",
  title: "Nvidia NIM",
  intro: "配置 Nvidia NIM 提供方及其模型目录。配置写入 llm-nvidia-completions 段。",
  providerHeading: "提供方",
  apiKey: "API 密钥",
  apiKeyHint: "以 NVIDIA_API_KEY 存储；留空表示保持当前密钥。",
  apiKeyStored: "已配置——输入新值可替换。",
  apiKeyUnset: "未配置。",
  baseUrl: "API 地址",
  baseUrlHint: "留空使用 https://integrate.api.nvidia.com/v1。",
  reasoningEffort: "默认推理强度",
  temperature: "默认采样温度（0–2）",
  topP: "默认核采样 top_p（0–1）",
  seed: "随机种子",
  maxTokens: "默认最大输出 token",
  contextWindow: "默认上下文窗口",
  modelsHeading: "模型目录",
  modelsHint: "每行的 id 会发送给提供方；上下文窗口与最大输出 token 留空时回落到上方提供方默认值。",
  addModel: "添加模型",
  removeModel: "删除",
  modelId: "模型 ID",
  modelName: "显示名称",
  modelDescription: "描述",
  modelContextWindow: "上下文窗口",
  modelMaxTokens: "最大输出 token",
  modelTopP: "top_p",
  modelInputModalities: "输入模态",
  text: "文本",
  image: "图片",
  save: "保存",
  saving: "保存中…",
  saved: "已保存。",
  failed: "保存失败。",
  readOnly: "当前部署这些设置为只读。",
  loading: "加载中…",
  unavailable: "llm-nvidia-completions 设置段不可用。",
  numberInvalid: "请输入有效数字。"
};

// -------------------------------------------------------------------------
// scope 响应式 hook：跳过需要模板的最小化 subscribe。
// -------------------------------------------------------------------------
function useScopeSnapshot(scope: SettingsScope<NvidiaConfig>) {
  const [snapshot, setSnapshot] = React.useState(() => scope.getSnapshot());
  React.useEffect(() => {
    setSnapshot(scope.getSnapshot());
    return scope.subscribe(() => setSnapshot(scope.getSnapshot()));
  }, [scope]);
  return snapshot;
}

// -------------------------------------------------------------------------
// 小工具
// -------------------------------------------------------------------------
function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}
function numberText(value: unknown) {
  const n = asNumber(value);
  return n === undefined ? "" : String(n);
}
function parseNumber(text: string) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : NaN;
}

// -------------------------------------------------------------------------
// 表单字段组件（标签 + 内容）
// -------------------------------------------------------------------------
function Field(props: FieldProps) {
  return jsx("label", {
    style: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
    children: [
      jsx("span", {
        style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, fontWeight: 500 },
        children: props.label
      }),
      props.children,
      props.hint === undefined
        ? null
        : jsx("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: props.hint })
    ]
  });
}

const inputStyle: React.CSSProperties = {
  boxSizing: "border-box",
  border: "1px solid var(--dsw-alias-border-l2)",
  width: "100%",
  height: 32,
  font: "inherit",
  background: "var(--dsw-alias-bg-layer-1)",
  color: "var(--dsw-alias-label-primary)",
  borderRadius: 8,
  padding: "0 10px",
  fontSize: 14
};

function TextField(props: InputProps) {
  return jsx("input", {
    type: "text",
    style: inputStyle,
    value: props.value === undefined ? "" : String(props.value),
    placeholder: props.placeholder,
    disabled: props.disabled,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)
  });
}

function NumberField(props: InputProps) {
  return jsx("input", {
    type: "text",
    inputMode: "decimal",
    style: inputStyle,
    value: props.value === undefined ? "" : String(props.value),
    placeholder: props.placeholder,
    disabled: props.disabled,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => props.onChange(e.target.value)
  });
}

function SelectField(props: SelectProps) {
  return jsx("select", {
    style: inputStyle,
    value: props.value === undefined ? "" : String(props.value),
    disabled: props.disabled,
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => props.onChange(e.target.value),
    children: props.options.map((opt) =>
      jsx("option", { value: opt.value, children: opt.label }, opt.value)
    )
  });
}

// -------------------------------------------------------------------------
// 模型目录编辑器
// -------------------------------------------------------------------------
const buttonStyle: React.CSSProperties = {
  font: "inherit",
  cursor: "pointer",
  border: "1px solid var(--dsw-alias-border-l2)",
  color: "var(--dsw-alias-label-primary)",
  background: "transparent",
  borderRadius: 14,
  height: 28,
  padding: "0 10px",
  fontSize: 12
};
const dangerButtonStyle = {
  ...buttonStyle,
  color: "var(--dsw-alias-state-error-primary)"
};
const primaryButtonStyle: React.CSSProperties = {
  font: "inherit",
  cursor: "pointer",
  border: "none",
  background: "var(--dsw-alias-button-primary-fill)",
  color: "var(--dsw-alias-label-primary-foreground)",
  borderRadius: 18,
  height: 32,
  padding: "0 14px",
  fontSize: 14
};

function ModelsEditor(props: ModelsProps) {
  const { models, t, disabled } = props;

  const update = <K extends keyof NvidiaCatalogModel>(index: number, key: K, value: NvidiaCatalogModel[K]) => {
    const next = models.map((m, i) => {
      if (i !== index) return m;
      const copy = { ...m };
      if (value === undefined) delete copy[key];
      else copy[key] = value;
      return copy;
    });
    props.onChange(next);
  };
  const remove = (index: number) => props.onChange(models.filter((_, i) => i !== index));
  const add = () => props.onChange([...models, { id: "" }]);

  const parseRaw = (text: string) => {
    if (text.trim().length === 0) return undefined;
    const n = Number(text);
    return Number.isFinite(n) ? n : NaN;
  };

  return jsx("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
    jsx("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [
      jsx("div", { children: [
        jsx("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, fontWeight: 500 }, children: t("modelsHeading") }),
        jsx("p", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, margin: "2px 0 0" }, children: t("modelsHint") })
      ] }),
      jsx("button", { type: "button", style: buttonStyle, disabled, onClick: add, children: t("addModel") })
    ] }),
    models.length === 0
      ? jsx("p", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, margin: 0 }, children: t("modelsHint") })
      : models.map((model, index) => {
          const id = typeof model.id === "string" ? model.id : "";
          const name = typeof model.name === "string" ? model.name : "";
          const description = typeof model.description === "string" ? model.description : "";

          // 数值字段：空串→清除，合法→写入，非法忽略。
          const intChange = (key: "contextWindow" | "maxTokens") => (v: string) => {
            if (v === "") { update(index, key, undefined); return; }
            const n = parseRaw(v);
            if (Number.isNaN(n) || !Number.isInteger(n)) return;
            update(index, key, n);
          };
          const numChange = (key: "topP") => (v: string) => {
            if (v === "") { update(index, key, undefined); return; }
            const n = parseRaw(v);
            if (Number.isNaN(n)) return;
            update(index, key, n);
          };

          const modalities: ("text" | "image")[] = model.inputModalities ?? ["text"];
          return jsx("div", {
            key: index,
            style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 },
            children: [
              jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }, children: [
                jsx(TextField, { value: id, placeholder: t("modelId"), disabled, onChange: (v: string) => update(index, "id", v) }),
                jsx(TextField, { value: name, placeholder: t("modelName"), disabled, onChange: (v: string) => update(index, "name", v.length === 0 ? undefined : v) })
              ] }),
              jsx(TextField, { value: description, placeholder: t("modelDescription"), disabled, onChange: (v: string) => update(index, "description", v.length === 0 ? undefined : v) }),
              jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }, children: [
                jsx(NumberField, { value: numberText(model.contextWindow), placeholder: t("modelContextWindow"), disabled, onChange: intChange("contextWindow") }),
                jsx(NumberField, { value: numberText(model.maxTokens), placeholder: t("modelMaxTokens"), disabled, onChange: intChange("maxTokens") }),
                jsx(NumberField, { value: numberText(model.topP), placeholder: t("modelTopP"), disabled, onChange: numChange("topP") })
              ] }),
              jsxs("div", { style: { display: "flex", gap: 12, alignItems: "center" }, children: [
                jsx("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: t("modelInputModalities") }),
                MODALITIES.map((m) =>
                  jsxs("label", { key: m, style: { display: "inline-flex", gap: 4, fontSize: 13, alignItems: "center" }, children: [
                    jsx("input", {
                      type: "checkbox",
                      checked: modalities.includes(m),
                      disabled,
                      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                        let next: ("text" | "image")[];
                        if (e.target.checked) next = [...new Set([...modalities, m])];
                        else next = modalities.filter((x) => x !== m);
                        update(index, "inputModalities", next.length === 0 ? undefined : next);
                      }
                    }),
                    t(m)
                  ] })
                ),
                jsx("button", {
                  type: "button",
                  style: { marginLeft: "auto", ...dangerButtonStyle },
                  disabled,
                  onClick: () => remove(index),
                  children: t("removeModel")
                })
              ] })
            ]
          });
        })
  ] });
}

// -------------------------------------------------------------------------
// 设置页主体
// -------------------------------------------------------------------------
function NvidiaSettingsSection(props: SettingsProps) {
  const { scope, api, t } = props;
  const snapshot = useScopeSnapshot(scope);

  // 各字段 draft（与 scope 值同步；编辑即时写回或按「保存」写入）
  const [draft, setDraft] = React.useState(() => snapshot);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<"saved" | "failed" | undefined>(undefined);
  const [keyDraft, setKeyDraft] = React.useState("");
  const [keyState, setKeyState] = React.useState<{ configured?: boolean } | undefined>(undefined);

  // 凭据状态
  React.useEffect(() => {
    let stale = false;
    api.credentials.describe([KEY_REF]).then((response) => {
      const result = "result" in response ? response.result : response;
      if (stale || !result?.ok) return;
      const credentials = result.value;
      setKeyState(credentials?.[KEY_REF]);
    }, () => {});
    return () => { stale = true; };
  }, [api.credentials]);

  // scope 变化 → 重建 draft
  React.useEffect(() => {
    setDraft(snapshot);
    setNotice(undefined);
  }, [snapshot]);

  if (snapshot.status === "loading") return jsx("p", { children: t("loading") });
  if (snapshot.status === "unavailable") return jsx("p", { children: t("unavailable") });

  const writable = snapshot.writable !== false && snapshot.mode !== "memory";
  const value = snapshot.value || {};

  const field = <K extends keyof NvidiaConfig>(key: K, fallback?: NvidiaConfig[K]) => (value[key] === undefined ? fallback : value[key]);

  const temperature = field("defaultTemperature");
  const topP = field("defaultTopP");
  const seed = field("seed");
  const maxTokens = field("maxTokens");
  const contextWindow = field("defaultContextWindow");
  const reasoningEffort = field("defaultReasoningEffort");
  const models = Array.isArray(value.models) ? value.models : [];

  // 数值字段统一处理：空串→清除，合法数值→写入，非法输入忽略（不污染 draft）。
  const numericChange = (key: "defaultTemperature" | "defaultTopP" | "seed" | "maxTokens" | "defaultContextWindow", raw: string) => {
    if (raw === "") { setDraft((d) => ({ ...d, value: { ...d.value, [key]: undefined } })); return; }
    const n = parseNumber(raw);
    if (Number.isNaN(n)) return;
    setDraft((d) => ({ ...d, value: { ...d.value, [key]: n } }));
  };

  return jsx("div", { style: { maxWidth: 720, display: "flex", flexDirection: "column", gap: 16 }, children: [
    jsx("div", { children: [
      jsx("h2", { style: { margin: 0, fontSize: 16, fontWeight: 600 }, children: t("providerHeading") }),
      jsx("p", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, margin: "2px 0 0" }, children: t("intro") })
    ] }),
    Field({ label: t("apiKey"), hint: t("apiKeyHint"), children: jsx(TextField, {
      value: keyDraft,
      placeholder: keyState?.configured === true ? t("apiKeyStored") : t("apiKeyUnset"),
      onChange: (v: string) => setKeyDraft(v)
    }) }),
    Field({ label: t("baseUrl"), hint: t("baseUrlHint"), children: jsx(TextField, {
      value: draft.value?.baseURL ?? value.baseURL ?? "",
      placeholder: "https://integrate.api.nvidia.com/v1",
      disabled: !writable,
      onChange: (v: string) => setDraft((d) => ({ ...d, value: { ...d.value, baseURL: v === "" ? undefined : v } }))
    }) }),
    Field({ label: t("reasoningEffort"), children: jsx(SelectField, {
      value: draft.value?.defaultReasoningEffort ?? reasoningEffort ?? "max",
      disabled: !writable,
      options: REASONING_EFFORTS.map((e) => ({ value: e, label: e })),
      onChange: (v: string) => setDraft((d) => ({ ...d, value: { ...d.value, defaultReasoningEffort: v as NvidiaConfig["defaultReasoningEffort"] } }))
    }) }),
    jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }, children: [
      Field({ label: t("temperature"), children: jsx(NumberField, {
        value: draft.value?.defaultTemperature ?? temperature,
        disabled: !writable,
        onChange: (v: string) => numericChange("defaultTemperature", v)
      }) }),
      Field({ label: t("topP"), children: jsx(NumberField, {
        value: draft.value?.defaultTopP ?? topP,
        disabled: !writable,
        onChange: (v: string) => numericChange("defaultTopP", v)
      }) }),
      Field({ label: t("seed"), children: jsx(NumberField, {
        value: draft.value?.seed ?? seed,
        disabled: !writable,
        onChange: (v: string) => numericChange("seed", v)
      }) })
    ] }),
    jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }, children: [
      Field({ label: t("maxTokens"), children: jsx(NumberField, {
        value: draft.value?.maxTokens ?? maxTokens,
        disabled: !writable,
        onChange: (v: string) => numericChange("maxTokens", v)
      }) }),
      Field({ label: t("contextWindow"), children: jsx(NumberField, {
        value: draft.value?.defaultContextWindow ?? contextWindow,
        disabled: !writable,
        onChange: (v: string) => numericChange("defaultContextWindow", v)
      }) })
    ] }),
    jsx(ModelsEditor, {
      t,
      disabled: !writable,
      models: draft.value?.models ?? models,
      onChange: (next: NvidiaCatalogModel[]) => setDraft((d) => ({ ...d, value: { ...d.value, models: next } }))
    }),
    writable ? jsx("div", { style: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }, children: [
      notice === "saved" ? jsx("span", { style: { color: "var(--dsw-alias-state-success-primary)", fontSize: 12 }, children: t("saved") }) : null,
      notice === "failed" ? jsx("span", { style: { color: "var(--dsw-alias-state-error-primary)", fontSize: 12 }, children: t("failed") }) : null,
      jsx("button", { type: "button", style: primaryButtonStyle, disabled: busy, onClick: async () => {
        // 先把 draft 写回 scope，再提交
        setBusy(true);
        setNotice(undefined);
        try {
          const dval = draft.value || {};
          const sends: Promise<unknown>[] = [];
          const setField = <K extends keyof NvidiaConfig>(k: K, v: NvidiaConfig[K]) => { if (v === undefined || v === "") sends.push(scope.unset(k)); else sends.push(scope.set(k, v)); };
          setField("baseURL", dval.baseURL);
          setField("defaultReasoningEffort", dval.defaultReasoningEffort);
          setField("defaultTemperature", dval.defaultTemperature);
          setField("defaultTopP", dval.defaultTopP);
          setField("seed", dval.seed);
          setField("maxTokens", dval.maxTokens);
          setField("defaultContextWindow", dval.defaultContextWindow);
          setField("models", dval.models);
          if (keyDraft.trim().length > 0) {
            const stored = await api.credentials.set(KEY_REF, keyDraft.trim());
            const result = "result" in stored ? stored.result : stored;
            if (!result?.ok) throw new Error(result?.error?.message || "credential rejected");
          }
          await Promise.all(sends);
          setKeyDraft("");
          setNotice("saved");
        } catch (e) {
          setNotice("failed");
        } finally {
          setBusy(false);
        }
      }, children: busy ? t("saving") : t("save") })
    ] }) : jsx("p", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: t("readOnly") })
  ] });
}

// -------------------------------------------------------------------------
// cordis 插件体
// -------------------------------------------------------------------------
const inject = ["slots", "locale", "remote", "remote.credentials", "settingsScope"];

function apply(ctx: Context) {
  const t = ctx.locale.bind(NS);
  ctx.effect(() => {
    const off1 = ctx.locale.register(NS, "zh", zh);
    const off2 = ctx.locale.register(NS, "en", en);
    return () => { off1(); off2(); };
  }, "nvidia: settings dictionaries");

  const remote = ctx.get("remote") as CredentialsRemote | undefined;
  if (remote === undefined) throw new Error("Nvidia settings require the remote service");
  const scope = ctx.settingsScope.bind<NvidiaConfig>({ namespace: SETTINGS_NS });

  const injected = () => ({ scope, api: remote, t });

  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "nvidia-nim",
    order: 45,
    label: () => t("nav"),
    locale: NS,
    inject: injected
  }, NvidiaSettingsSection));
}

export { apply, inject };
export default { apply, inject };
