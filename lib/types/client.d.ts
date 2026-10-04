import type { Context } from "@deepseek-ai/cordis";
declare module "@deepseek-ai/dsh-client-ui-slots" {
    interface LocaleNamespaceMap {
        "settings.nvidia": keyof typeof en;
    }
}
declare const en: {
    nav: string;
    title: string;
    intro: string;
    providerHeading: string;
    apiKey: string;
    apiKeyHint: string;
    apiKeyStored: string;
    apiKeyUnset: string;
    baseUrl: string;
    baseUrlHint: string;
    reasoningEffort: string;
    temperature: string;
    topP: string;
    seed: string;
    maxTokens: string;
    contextWindow: string;
    modelsHeading: string;
    modelsHint: string;
    addModel: string;
    removeModel: string;
    modelId: string;
    modelName: string;
    modelDescription: string;
    modelContextWindow: string;
    modelMaxTokens: string;
    modelTopP: string;
    modelInputModalities: string;
    text: string;
    image: string;
    save: string;
    saving: string;
    saved: string;
    failed: string;
    readOnly: string;
    loading: string;
    unavailable: string;
    numberInvalid: string;
};
declare const inject: string[];
declare function apply(ctx: Context): void;
export { apply, inject };
declare const _default: {
    apply: typeof apply;
    inject: string[];
};
export default _default;
