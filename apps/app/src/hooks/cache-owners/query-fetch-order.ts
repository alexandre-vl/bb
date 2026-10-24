import type { Query, QueryClient } from "@tanstack/react-query";

let latestQueryFetchOrder = 0;
const queryFetchOrders = new WeakMap<Query, number>();

export function trackQueryFetchOrder(queryClient: QueryClient): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "fetch") {
      return;
    }
    latestQueryFetchOrder += 1;
    queryFetchOrders.set(event.query, latestQueryFetchOrder);
  });
}

export function readLatestQueryFetchOrder(): number {
  return latestQueryFetchOrder;
}

export function queryFetchStartedAfter(
  query: Query,
  fetchOrder: number,
): boolean {
  return (queryFetchOrders.get(query) ?? 0) > fetchOrder;
}
