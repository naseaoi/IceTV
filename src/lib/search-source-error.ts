// 源站第 1 页请求失败（超时、HTTP 错误、网络或解析异常），区别于“搜索成功但无结果”
export class SearchSourceUnavailableError extends Error {
  constructor(sourceName: string) {
    super(`${sourceName} search unavailable`);
    this.name = 'SearchSourceUnavailableError';
  }
}
