/**
 * worker ↔ gateway 的 WebSocket 协议（push 派发模型的服务间契约）。
 * gateway（api 侧）与 worker-agent（worker 侧）共用这些类型,确保两端消息一致。
 */

/** worker → gateway 的上行消息 */
export type WorkerMessage =
  | { type: 'register'; workerId: string; concurrency: number }
  | { type: 'heartbeat'; workerId: string; cpu: number; memory: number; activeJobs: number }
  | {
      type: 'job_result';
      workerId: string;
      jobId: number;
      status: 'succeeded' | 'failed';
      error?: string;
    }
  | { type: 'job_progress'; workerId: string; jobId: number };

/** gateway → worker 的下行消息 */
export type GatewayMessage =
  | { type: 'registered'; workerId: string }
  | { type: 'dispatch'; jobId: number; postId: string; providerId: number | null; model: string }
  | { type: 'ping' };

/**
 * 派发器接口：入队后触发一次派发。AnalysisConfigService 持有它的可选引用
 * （api 侧注入真正的 GatewayService;worker 侧不入队,留空即可）。
 */
export interface Dispatcher {
  tryDispatch(): Promise<void>;
}
