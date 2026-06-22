/**
 * 任务派发契约（框架无关）：把「入队后触发一次派发」抽象成单一接口，
 * 让生产侧（PipelineService）只认接口、不认实现。
 *
 * 单进程归一后实现为 LocalDispatcher（同进程认领 + 直接调 WorkerService 执行）；
 * 历史上曾以 WS push 网关（GatewayService）跨进程实现，故契约下沉到 kernel 保持解耦。
 */

/**
 * 派发器接口：入队后触发一次派发。PipelineService 持有它的可选引用
 * （装配时注入 LocalDispatcher；不需派发的场景留空即可）。
 */
export interface Dispatcher {
  tryDispatch(): Promise<void>;
}
