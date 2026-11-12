import { useState } from 'react';
import { Button, Form, Input, Typography, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { login } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import Logo from '../Layout/Logo';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const authLogin = useAuthStore((s) => s.login);

  const handleSubmit = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const { token, role } = await login(values.username, values.password);
      authLogin(token, role, values.username);
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #0f1729 0%, #1e293b 100%)',
    }}>
      <div style={{
        width: 380,
        background: 'var(--sr-card)',
        borderRadius: 16,
        padding: '40px 32px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-block', marginBottom: 12 }}>
            <Logo size={48} />
          </div>
          <Typography.Title level={3} style={{ margin: 0, color: 'var(--sr-text)' }}>
            StarRocks Manager
          </Typography.Title>
          <Typography.Text type="secondary">
            Sign in to continue
          </Typography.Text>
        </div>

        <Form
          layout="vertical"
          onFinish={handleSubmit}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: 'Username is required' }]}
          >
            <Input
              prefix={<UserOutlined style={{ color: 'var(--sr-text-muted)' }} />}
              placeholder="Username"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Password is required' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: 'var(--sr-text-muted)' }} />}
              placeholder="Password"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{
                height: 44,
                borderRadius: 10,
                fontWeight: 600,
                fontSize: 15,
              }}
            >
              Sign In
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
}
