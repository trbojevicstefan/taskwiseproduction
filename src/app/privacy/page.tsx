// src/app/privacy/page.tsx
import LegalPageLayout from '@/components/layouts/LegalPageLayout';
import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Privacy Policy | TaskWiseAI',
    description: 'Privacy Policy for the TaskWiseAI application.',
};

export default function PrivacyPolicyPage() {
  return (
    <LegalPageLayout title="Privacy Policy">
        <p>Last updated: December 29, 2025</p>

        <h2>1. Overview</h2>
        <p>This Privacy Policy explains how TaskWiseAI collects, uses, and shares information when you use our website, apps, and services (the "Service").</p>

        <h2>2. Information We Collect</h2>
        <ul>
            <li><strong>Account Data:</strong> Name, email address, workspace name, and profile details you provide when you register or update your account.</li>
            <li><strong>Content Data:</strong> Tasks, notes, meeting transcripts, files, and other content you submit or generate in the Service.</li>
            <li><strong>Integration Data:</strong> Data received from connected services (e.g., Google, Slack, Trello) as authorized by you, such as profile details and content required for the integration.</li>
            <li><strong>Usage Data:</strong> Log data like IP address, device and browser type, pages viewed, and feature interactions.</li>
            <li><strong>Cookies and Similar Technologies:</strong> We use cookies and local storage to keep you signed in, remember preferences, and understand usage patterns.</li>
        </ul>

        <h2>3. How We Use Information</h2>
        <ul>
            <li>Provide, maintain, and improve the Service.</li>
            <li>Process your content through AI models to generate tasks, summaries, and insights.</li>
            <li>Enable and manage integrations you connect.</li>
            <li>Provide support, send service updates, and respond to requests.</li>
            <li>Monitor usage for security, fraud prevention, and performance.</li>
        </ul>

        <h2>4. Sharing and Disclosure</h2>
        <ul>
            <li><strong>Service Providers:</strong> Vendors who help us operate the Service, such as hosting, analytics, email delivery, and AI processing.</li>
            <li><strong>Integrations:</strong> When you connect third-party services, data may be shared as needed for those integrations to work.</li>
            <li><strong>Legal and Safety:</strong> When required by law or to protect rights, safety, and security.</li>
            <li><strong>Business Transfers:</strong> In connection with a merger, acquisition, or asset sale.</li>
        </ul>

        <h2>5. Data Retention</h2>
        <p>We retain information for as long as your account is active or as needed to provide the Service. You can request deletion at any time, subject to legal or operational requirements.</p>

        <h2>6. Security</h2>
        <p>We use administrative, technical, and physical safeguards to protect your information. No security system is perfect, and we cannot guarantee absolute security.</p>

        <h2>7. Your Choices</h2>
        <ul>
            <li>Update account details in your profile settings.</li>
            <li>Disconnect integrations at any time.</li>
            <li>Request access or deletion by contacting us.</li>
        </ul>

        <h2>8. International Transfers</h2>
        <p>Your information may be processed in countries where our providers operate. We take steps to protect your data consistent with this policy.</p>

        <h2>9. Children's Privacy</h2>
        <p>The Service is not directed to children under 13, and we do not knowingly collect personal information from them.</p>

        <h2>10. Changes to This Policy</h2>
        <p>We may update this policy from time to time. We will post the latest version on this page.</p>

        <h2>11. Contact Us</h2>
        <p>If you have questions, contact us at: privacy@taskwise.ai</p>
    </LegalPageLayout>
  );
}
