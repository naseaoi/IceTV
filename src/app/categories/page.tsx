import { redirect } from 'next/navigation';

// 分类入口已并入首页频道条，保留路由兼容旧链接
export default function CategoriesPage() {
  redirect('/');
}
