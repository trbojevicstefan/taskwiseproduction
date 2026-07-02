// src/app/signup/page.tsx
import AuthPageLayout from '@/components/layouts/AuthPageLayout';
import SignupForm from '@/components/auth/SignupForm';

export default function SignupPage() {
  return (
    <AuthPageLayout title="Sign Up for TaskWiseAI" description="Start managing your tasks smarter.">
      <SignupForm />
    </AuthPageLayout>
  );
}
