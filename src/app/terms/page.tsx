// src/app/terms/page.tsx
import LegalPageLayout from '@/components/layouts/LegalPageLayout';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Terms of Service | TaskWiseAI',
    description: 'Terms of Service for the TaskWiseAI application.',
};

export default function TermsOfServicePage() {
  return (
    <LegalPageLayout title="Terms of Service">
        <p>Last updated: {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

        <h2>1. Agreement to Terms</h2>
        <p>By using our services, you agree to be bound by these Terms of Service. If you do not agree to these Terms, do not use the services.</p>

        <h2>2. Description of Service</h2>
        <p>TaskWiseAI provides a platform for task management, AI-powered task extraction, and integration with third-party services. The service is provided "as is" and we make no guarantees regarding its availability or functionality.</p>
        
        <h2>3. User Responsibilities</h2>
        <p>You are responsible for your conduct and your content. You agree to comply with all applicable laws and regulations in connection with your use of the service. You are responsible for maintaining the confidentiality of your account and password.</p>
        
        <h2>4. Intellectual Property</h2>
        <p>You retain full ownership of the content you create and submit to the service. By using the service, you grant us a worldwide, royalty-free license to use, reproduce, modify, and process the content solely for the purpose of providing the service to you. This includes sending your content to our third-party AI model providers for processing.</p>

        <h2>5. Prohibited Activities</h2>
        <p>You agree not to engage in any of the following prohibited activities:</p>
        <ul>
            <li>Using the service for any illegal purpose or in violation of any local, state, national, or international law.</li>
            <li>Submitting content that is unlawful, harmful, defamatory, or otherwise objectionable.</li>
            <li>Attempting to interfere with, compromise the system integrity or security, or decipher any transmissions to or from the servers running the service.</li>
        </ul>

        <h2>6. Limitation of Liability</h2>
        <p>To the fullest extent permitted by applicable law, TaskWiseAI shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses, resulting from (a) your access to or use of or inability to access or use the service; (b) any conduct or content of any third party on the service.</p>
        
        <h2>7. Termination</h2>
        <p>We may terminate or suspend your access to our service immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms.</p>

        <h2>8. Changes to Terms</h2>
        <p>We reserve the right, at our sole discretion, to modify or replace these Terms at any time. We will provide notice of any changes by posting the new Terms of Service on this page.</p>
        
        <h2>9. Contact Us</h2>
        <p>If you have any questions about these Terms, please contact us at: support@taskwise.ai</p>
    </LegalPageLayout>
  );
}
