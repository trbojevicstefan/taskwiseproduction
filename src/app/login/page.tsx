// src/app/login/page.tsx
import AuthPageLayout from '@/components/layouts/AuthPageLayout';
import LoginForm from '@/components/auth/LoginForm';

export default function LoginPage() {
  return (
    <AuthPageLayout title="Login to TaskWiseAI" description="Access your tasks and projects.">
      <LoginForm />
    </AuthPageLayout>
  );
}
