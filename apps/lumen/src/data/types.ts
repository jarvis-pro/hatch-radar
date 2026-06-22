/** 信号强度（雷达光点亮度 / 强度色阶）。 */
export type Intensity = 'high' | 'medium' | 'low';

/** 情报来源渠道。 */
export type SourceKind = 'reddit' | 'hackernews' | 'producthunt' | 'github' | 'rss';

/** 一条来自社区的原始佐证（用户原声）。 */
export interface Evidence {
  /** 用户原话（已译中文，保留口吻）。 */
  quote: string;
  /** 发言者（脱敏句柄）。 */
  author: string;
  source: SourceKind;
  /** 渠道展示名，如 r/SaaS、Hacker News。 */
  channel: string;
  /** 赞同 / 热度。 */
  upvotes: number;
}

/** 被反复提及的痛点，及其在样本中的提及频度（0–100）。 */
export interface PainPoint {
  text: string;
  frequency: number;
}

/**
 * 一个被 AI 从社区噪声里提炼出来的「产品机会」。
 * 既是雷达上的一个光点，也是探索/收藏/详情各页的核心实体。
 */
export interface Opportunity {
  id: string;
  /** 机会标题（一句话能记住的产品角度）。 */
  title: string;
  /** 电梯陈述（它解决谁的什么问题）。 */
  pitch: string;
  /** 赛道。 */
  category: string;
  /** 信号强度。 */
  intensity: Intensity;
  /** 机会分（0–100，AI 综合需求强度 / 竞争 / 可行性）。 */
  score: number;
  /** 近 7 日声量动量（百分比，可为负）。 */
  momentum: number;
  /** 累计抓到的相关信号条数。 */
  mentions: number;
  /** 信号覆盖的不同社区数。 */
  communities: number;
  /** 主来源。 */
  source: SourceKind;
  /** 主渠道展示名。 */
  channel: string;
  tags: string[];
  painPoints: PainPoint[];
  evidence: Evidence[];
  /** 雷达极坐标：角度（deg, 0=正右，顺时针）。 */
  angle: number;
  /** 雷达极坐标：归一化半径（0=圆心，1=最外环）。 */
  radius: number;
  /** 距发现的分钟数（演示用相对时间，避免硬编码绝对时刻）。 */
  ageMinutes: number;
}

/** 雷达正在扫描的源（首页状态条用）。 */
export interface ScanSource {
  label: string;
  kind: SourceKind;
}
