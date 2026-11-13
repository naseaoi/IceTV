// 只改地址栏不走路由，避免重新请求服务端组件。state 传 null：带着 Next 内部
// 标记（__NA）的 state 会被当作路由自身调用而不同步，之后路由重渲染会把地址改回去
export function replaceSearchParamInUrl(name: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  window.history.replaceState(null, '', url);
}
