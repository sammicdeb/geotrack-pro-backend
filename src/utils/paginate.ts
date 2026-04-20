export const paginate = (page?: string, limit?: string) => {
  const p = Math.max(1, parseInt(page ?? '1', 10));
  const l = Math.min(100, Math.max(1, parseInt(limit ?? '20', 10)));
  return { skip: (p - 1) * l, take: l, page: p, limit: l };
};
