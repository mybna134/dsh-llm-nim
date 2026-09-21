/**
 * Nvidia NIM 设置页（client bundle）。
 *
 * 通过 `settings.section` 插槽注册一个「Nvidia NIM」设置页，用于在 Web 界面
 * 配置 provider（API key / baseURL / 推理强度 / 采样温度 / top_p / 种子 / 输出
 * 上限 / 默认上下文窗口）与模型目录（id / 名称 / 描述 / 上下文窗口 / 最大输出
 * token / topP / 输入模态）。配置读写落回 `llm-nvidia-completions:` settings 段，
 * API key 走 credentials（`NVIDIA_API_KEY`）。
 *
 * 该 bundle 是懒加载 CJS 形态：由 `window.__ModuleLoader__.load` 自注册 factory，
 * 运行时由 `@deepseek-ai/dsh-client-modules` 按 `dsh.client` 声明装配并加载。
 */
import type { Context } from '@deepseek-ai/cordis';

/** client 插件依赖的 cordis 服务。 */
export declare const inject: string[];

/** client 插件体：注册 locale 文案与 settings.section 设置页。 */
export declare function apply(ctx: Context): void;

declare const plugin: { apply: typeof apply; inject: typeof inject };
export { plugin as default };