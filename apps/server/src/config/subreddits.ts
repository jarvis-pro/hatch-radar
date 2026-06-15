/**
 * 默认监控的 Reddit 版块列表——**仅作首启种子**（SourcesSeeder 写入 sources 表）。
 * 首启之后请在 Web 设置页增减来源，勿改此处：库非空时本列表不再被读取（见 [[seed-mechanism-design]]）。
 */
export const SUBREDDITS = [
  // 通用创业 / 产品
  'entrepreneur',
  'startups',
  'indiehackers',
  'SaaS',

  // 需求直接表达
  'SomebodyMakeThis',
  'AppIdeas',

  // 按需补充垂直领域
  // "marketing",
  // "ecommerce",
];
