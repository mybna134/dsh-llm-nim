window.__ModuleLoader__.load({ id: "dsh-llm-nvidia-completions", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  default: () => client_default,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var React = __toESM(require("react"), 1);
var import_jsx_runtime = require("react/jsx-runtime");
var SETTINGS_NS = "llm-nvidia-completions";
var KEY_REF = "NVIDIA_API_KEY";
var NS = "settings.nvidia";
var REASONING_EFFORTS = ["off", "low", "high", "max"];
var MODALITIES = ["text", "image"];
var en = {
  nav: "Nvidia NIM",
  title: "Nvidia NIM",
  intro: "Configure the Nvidia NIM provider and its model catalog. Values are written to the llm-nvidia-completions section.",
  providerHeading: "Provider",
  apiKey: "API key",
  apiKeyHint: "Stored as NVIDIA_API_KEY; leave blank to keep the current key.",
  apiKeyStored: "Configured \u2014 enter a new value to replace.",
  apiKeyUnset: "Not configured.",
  baseUrl: "Base URL",
  baseUrlHint: "Leave blank to use https://integrate.api.nvidia.com/v1.",
  reasoningEffort: "Default reasoning effort",
  temperature: "Default temperature (0\u20132)",
  topP: "Default top_p (0\u20131)",
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
  saving: "Saving\u2026",
  saved: "Saved.",
  failed: "Save failed.",
  readOnly: "These settings are read-only in this deployment.",
  loading: "Loading\u2026",
  unavailable: "The llm-nvidia-completions settings section is unavailable.",
  numberInvalid: "Please enter a valid number."
};
var zh = {
  nav: "Nvidia NIM",
  title: "Nvidia NIM",
  intro: "\u914D\u7F6E Nvidia NIM \u63D0\u4F9B\u65B9\u53CA\u5176\u6A21\u578B\u76EE\u5F55\u3002\u914D\u7F6E\u5199\u5165 llm-nvidia-completions \u6BB5\u3002",
  providerHeading: "\u63D0\u4F9B\u65B9",
  apiKey: "API \u5BC6\u94A5",
  apiKeyHint: "\u4EE5 NVIDIA_API_KEY \u5B58\u50A8\uFF1B\u7559\u7A7A\u8868\u793A\u4FDD\u6301\u5F53\u524D\u5BC6\u94A5\u3002",
  apiKeyStored: "\u5DF2\u914D\u7F6E\u2014\u2014\u8F93\u5165\u65B0\u503C\u53EF\u66FF\u6362\u3002",
  apiKeyUnset: "\u672A\u914D\u7F6E\u3002",
  baseUrl: "API \u5730\u5740",
  baseUrlHint: "\u7559\u7A7A\u4F7F\u7528 https://integrate.api.nvidia.com/v1\u3002",
  reasoningEffort: "\u9ED8\u8BA4\u63A8\u7406\u5F3A\u5EA6",
  temperature: "\u9ED8\u8BA4\u91C7\u6837\u6E29\u5EA6\uFF080\u20132\uFF09",
  topP: "\u9ED8\u8BA4\u6838\u91C7\u6837 top_p\uFF080\u20131\uFF09",
  seed: "\u968F\u673A\u79CD\u5B50",
  maxTokens: "\u9ED8\u8BA4\u6700\u5927\u8F93\u51FA token",
  contextWindow: "\u9ED8\u8BA4\u4E0A\u4E0B\u6587\u7A97\u53E3",
  modelsHeading: "\u6A21\u578B\u76EE\u5F55",
  modelsHint: "\u6BCF\u884C\u7684 id \u4F1A\u53D1\u9001\u7ED9\u63D0\u4F9B\u65B9\uFF1B\u4E0A\u4E0B\u6587\u7A97\u53E3\u4E0E\u6700\u5927\u8F93\u51FA token \u7559\u7A7A\u65F6\u56DE\u843D\u5230\u4E0A\u65B9\u63D0\u4F9B\u65B9\u9ED8\u8BA4\u503C\u3002",
  addModel: "\u6DFB\u52A0\u6A21\u578B",
  removeModel: "\u5220\u9664",
  modelId: "\u6A21\u578B ID",
  modelName: "\u663E\u793A\u540D\u79F0",
  modelDescription: "\u63CF\u8FF0",
  modelContextWindow: "\u4E0A\u4E0B\u6587\u7A97\u53E3",
  modelMaxTokens: "\u6700\u5927\u8F93\u51FA token",
  modelTopP: "top_p",
  modelInputModalities: "\u8F93\u5165\u6A21\u6001",
  text: "\u6587\u672C",
  image: "\u56FE\u7247",
  save: "\u4FDD\u5B58",
  saving: "\u4FDD\u5B58\u4E2D\u2026",
  saved: "\u5DF2\u4FDD\u5B58\u3002",
  failed: "\u4FDD\u5B58\u5931\u8D25\u3002",
  readOnly: "\u5F53\u524D\u90E8\u7F72\u8FD9\u4E9B\u8BBE\u7F6E\u4E3A\u53EA\u8BFB\u3002",
  loading: "\u52A0\u8F7D\u4E2D\u2026",
  unavailable: "llm-nvidia-completions \u8BBE\u7F6E\u6BB5\u4E0D\u53EF\u7528\u3002",
  numberInvalid: "\u8BF7\u8F93\u5165\u6709\u6548\u6570\u5B57\u3002"
};
function useScopeSnapshot(scope) {
  const [snapshot, setSnapshot] = React.useState(() => scope.getSnapshot());
  React.useEffect(() => {
    setSnapshot(scope.getSnapshot());
    return scope.subscribe(() => setSnapshot(scope.getSnapshot()));
  }, [scope]);
  return snapshot;
}
function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return void 0;
}
function numberText(value) {
  const n = asNumber(value);
  return n === void 0 ? "" : String(n);
}
function parseNumber(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return void 0;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : NaN;
}
function Field(props) {
  return (0, import_jsx_runtime.jsx)("label", {
    style: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
    children: [
      (0, import_jsx_runtime.jsx)("span", {
        style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, fontWeight: 500 },
        children: props.label
      }),
      props.children,
      props.hint === void 0 ? null : (0, import_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: props.hint })
    ]
  });
}
var inputStyle = {
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
function TextField(props) {
  return (0, import_jsx_runtime.jsx)("input", {
    type: "text",
    style: inputStyle,
    value: props.value === void 0 ? "" : String(props.value),
    placeholder: props.placeholder,
    disabled: props.disabled,
    onChange: (e) => props.onChange(e.target.value)
  });
}
function NumberField(props) {
  return (0, import_jsx_runtime.jsx)("input", {
    type: "text",
    inputMode: "decimal",
    style: inputStyle,
    value: props.value === void 0 ? "" : String(props.value),
    placeholder: props.placeholder,
    disabled: props.disabled,
    onChange: (e) => props.onChange(e.target.value)
  });
}
function SelectField(props) {
  return (0, import_jsx_runtime.jsx)("select", {
    style: inputStyle,
    value: props.value === void 0 ? "" : String(props.value),
    disabled: props.disabled,
    onChange: (e) => props.onChange(e.target.value),
    children: props.options.map(
      (opt) => (0, import_jsx_runtime.jsx)("option", { value: opt.value, children: opt.label }, opt.value)
    )
  });
}
var buttonStyle = {
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
var dangerButtonStyle = {
  ...buttonStyle,
  color: "var(--dsw-alias-state-error-primary)"
};
var primaryButtonStyle = {
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
function ModelsEditor(props) {
  const { models, t, disabled } = props;
  const update = (index, key, value) => {
    const next = models.map((m, i) => {
      if (i !== index) return m;
      const copy = { ...m };
      if (value === void 0) delete copy[key];
      else copy[key] = value;
      return copy;
    });
    props.onChange(next);
  };
  const remove = (index) => props.onChange(models.filter((_, i) => i !== index));
  const add = () => props.onChange([...models, { id: "" }]);
  const parseRaw = (text) => {
    if (text.trim().length === 0) return void 0;
    const n = Number(text);
    return Number.isFinite(n) ? n : NaN;
  };
  return (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
    (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [
      (0, import_jsx_runtime.jsx)("div", { children: [
        (0, import_jsx_runtime.jsx)("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, fontWeight: 500 }, children: t("modelsHeading") }),
        (0, import_jsx_runtime.jsx)("p", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, margin: "2px 0 0" }, children: t("modelsHint") })
      ] }),
      (0, import_jsx_runtime.jsx)("button", { type: "button", style: buttonStyle, disabled, onClick: add, children: t("addModel") })
    ] }),
    models.length === 0 ? (0, import_jsx_runtime.jsx)("p", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, margin: 0 }, children: t("modelsHint") }) : models.map((model, index) => {
      const id = typeof model.id === "string" ? model.id : "";
      const name = typeof model.name === "string" ? model.name : "";
      const description = typeof model.description === "string" ? model.description : "";
      const intChange = (key) => (v) => {
        if (v === "") {
          update(index, key, void 0);
          return;
        }
        const n = parseRaw(v);
        if (Number.isNaN(n) || !Number.isInteger(n)) return;
        update(index, key, n);
      };
      const numChange = (key) => (v) => {
        if (v === "") {
          update(index, key, void 0);
          return;
        }
        const n = parseRaw(v);
        if (Number.isNaN(n)) return;
        update(index, key, n);
      };
      const modalities = model.inputModalities ?? ["text"];
      return (0, import_jsx_runtime.jsx)("div", {
        key: index,
        style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 },
        children: [
          (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }, children: [
            (0, import_jsx_runtime.jsx)(TextField, { value: id, placeholder: t("modelId"), disabled, onChange: (v) => update(index, "id", v) }),
            (0, import_jsx_runtime.jsx)(TextField, { value: name, placeholder: t("modelName"), disabled, onChange: (v) => update(index, "name", v.length === 0 ? void 0 : v) })
          ] }),
          (0, import_jsx_runtime.jsx)(TextField, { value: description, placeholder: t("modelDescription"), disabled, onChange: (v) => update(index, "description", v.length === 0 ? void 0 : v) }),
          (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }, children: [
            (0, import_jsx_runtime.jsx)(NumberField, { value: numberText(model.contextWindow), placeholder: t("modelContextWindow"), disabled, onChange: intChange("contextWindow") }),
            (0, import_jsx_runtime.jsx)(NumberField, { value: numberText(model.maxTokens), placeholder: t("modelMaxTokens"), disabled, onChange: intChange("maxTokens") }),
            (0, import_jsx_runtime.jsx)(NumberField, { value: numberText(model.topP), placeholder: t("modelTopP"), disabled, onChange: numChange("topP") })
          ] }),
          (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 12, alignItems: "center" }, children: [
            (0, import_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: t("modelInputModalities") }),
            MODALITIES.map(
              (m) => (0, import_jsx_runtime.jsxs)("label", { key: m, style: { display: "inline-flex", gap: 4, fontSize: 13, alignItems: "center" }, children: [
                (0, import_jsx_runtime.jsx)("input", {
                  type: "checkbox",
                  checked: modalities.includes(m),
                  disabled,
                  onChange: (e) => {
                    let next;
                    if (e.target.checked) next = [.../* @__PURE__ */ new Set([...modalities, m])];
                    else next = modalities.filter((x) => x !== m);
                    update(index, "inputModalities", next.length === 0 ? void 0 : next);
                  }
                }),
                t(m)
              ] })
            ),
            (0, import_jsx_runtime.jsx)("button", {
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
function NvidiaSettingsSection(props) {
  const { scope, api, t } = props;
  const snapshot = useScopeSnapshot(scope);
  const [draft, setDraft] = React.useState(() => snapshot);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState(void 0);
  const [keyDraft, setKeyDraft] = React.useState("");
  const [keyState, setKeyState] = React.useState(void 0);
  React.useEffect(() => {
    let stale = false;
    api.credentials.describe([KEY_REF]).then((response) => {
      const result = "result" in response ? response.result : response;
      if (stale || !result?.ok) return;
      const credentials = result.value;
      setKeyState(credentials?.[KEY_REF]);
    }, () => {
    });
    return () => {
      stale = true;
    };
  }, [api.credentials]);
  React.useEffect(() => {
    setDraft(snapshot);
    setNotice(void 0);
  }, [snapshot]);
  if (snapshot.status === "loading") return (0, import_jsx_runtime.jsx)("p", { children: t("loading") });
  if (snapshot.status === "unavailable") return (0, import_jsx_runtime.jsx)("p", { children: t("unavailable") });
  const writable = snapshot.writable !== false && snapshot.mode !== "memory";
  const value = snapshot.value || {};
  const field = (key, fallback) => value[key] === void 0 ? fallback : value[key];
  const temperature = field("defaultTemperature");
  const topP = field("defaultTopP");
  const seed = field("seed");
  const maxTokens = field("maxTokens");
  const contextWindow = field("defaultContextWindow");
  const reasoningEffort = field("defaultReasoningEffort");
  const models = Array.isArray(value.models) ? value.models : [];
  const numericChange = (key, raw) => {
    if (raw === "") {
      setDraft((d) => ({ ...d, value: { ...d.value, [key]: void 0 } }));
      return;
    }
    const n = parseNumber(raw);
    if (Number.isNaN(n)) return;
    setDraft((d) => ({ ...d, value: { ...d.value, [key]: n } }));
  };
  return (0, import_jsx_runtime.jsx)("div", { style: { maxWidth: 720, display: "flex", flexDirection: "column", gap: 16 }, children: [
    (0, import_jsx_runtime.jsx)("div", { children: [
      (0, import_jsx_runtime.jsx)("h2", { style: { margin: 0, fontSize: 16, fontWeight: 600 }, children: t("providerHeading") }),
      (0, import_jsx_runtime.jsx)("p", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, margin: "2px 0 0" }, children: t("intro") })
    ] }),
    Field({ label: t("apiKey"), hint: t("apiKeyHint"), children: (0, import_jsx_runtime.jsx)(TextField, {
      value: keyDraft,
      placeholder: keyState?.configured === true ? t("apiKeyStored") : t("apiKeyUnset"),
      onChange: (v) => setKeyDraft(v)
    }) }),
    Field({ label: t("baseUrl"), hint: t("baseUrlHint"), children: (0, import_jsx_runtime.jsx)(TextField, {
      value: draft.value?.baseURL ?? value.baseURL ?? "",
      placeholder: "https://integrate.api.nvidia.com/v1",
      disabled: !writable,
      onChange: (v) => setDraft((d) => ({ ...d, value: { ...d.value, baseURL: v === "" ? void 0 : v } }))
    }) }),
    Field({ label: t("reasoningEffort"), children: (0, import_jsx_runtime.jsx)(SelectField, {
      value: draft.value?.defaultReasoningEffort ?? reasoningEffort ?? "max",
      disabled: !writable,
      options: REASONING_EFFORTS.map((e) => ({ value: e, label: e })),
      onChange: (v) => setDraft((d) => ({ ...d, value: { ...d.value, defaultReasoningEffort: v } }))
    }) }),
    (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }, children: [
      Field({ label: t("temperature"), children: (0, import_jsx_runtime.jsx)(NumberField, {
        value: draft.value?.defaultTemperature ?? temperature,
        disabled: !writable,
        onChange: (v) => numericChange("defaultTemperature", v)
      }) }),
      Field({ label: t("topP"), children: (0, import_jsx_runtime.jsx)(NumberField, {
        value: draft.value?.defaultTopP ?? topP,
        disabled: !writable,
        onChange: (v) => numericChange("defaultTopP", v)
      }) }),
      Field({ label: t("seed"), children: (0, import_jsx_runtime.jsx)(NumberField, {
        value: draft.value?.seed ?? seed,
        disabled: !writable,
        onChange: (v) => numericChange("seed", v)
      }) })
    ] }),
    (0, import_jsx_runtime.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }, children: [
      Field({ label: t("maxTokens"), children: (0, import_jsx_runtime.jsx)(NumberField, {
        value: draft.value?.maxTokens ?? maxTokens,
        disabled: !writable,
        onChange: (v) => numericChange("maxTokens", v)
      }) }),
      Field({ label: t("contextWindow"), children: (0, import_jsx_runtime.jsx)(NumberField, {
        value: draft.value?.defaultContextWindow ?? contextWindow,
        disabled: !writable,
        onChange: (v) => numericChange("defaultContextWindow", v)
      }) })
    ] }),
    (0, import_jsx_runtime.jsx)(ModelsEditor, {
      t,
      disabled: !writable,
      models: draft.value?.models ?? models,
      onChange: (next) => setDraft((d) => ({ ...d, value: { ...d.value, models: next } }))
    }),
    writable ? (0, import_jsx_runtime.jsx)("div", { style: { display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }, children: [
      notice === "saved" ? (0, import_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-state-success-primary)", fontSize: 12 }, children: t("saved") }) : null,
      notice === "failed" ? (0, import_jsx_runtime.jsx)("span", { style: { color: "var(--dsw-alias-state-error-primary)", fontSize: 12 }, children: t("failed") }) : null,
      (0, import_jsx_runtime.jsx)("button", { type: "button", style: primaryButtonStyle, disabled: busy, onClick: async () => {
        setBusy(true);
        setNotice(void 0);
        try {
          const dval = draft.value || {};
          const sends = [];
          const setField = (k, v) => {
            if (v === void 0 || v === "") sends.push(scope.unset(k));
            else sends.push(scope.set(k, v));
          };
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
    ] }) : (0, import_jsx_runtime.jsx)("p", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 }, children: t("readOnly") })
  ] });
}
var inject = ["slots", "locale", "remote", "remote.credentials", "settingsScope"];
function apply(ctx) {
  const t = ctx.locale.bind(NS);
  ctx.effect(() => {
    const off1 = ctx.locale.register(NS, "zh", zh);
    const off2 = ctx.locale.register(NS, "en", en);
    return () => {
      off1();
      off2();
    };
  }, "nvidia: settings dictionaries");
  const remote = ctx.get("remote");
  if (remote === void 0) throw new Error("Nvidia settings require the remote service");
  const scope = ctx.settingsScope.bind({ namespace: SETTINGS_NS });
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
var client_default = { apply, inject };
return module.exports; } });
