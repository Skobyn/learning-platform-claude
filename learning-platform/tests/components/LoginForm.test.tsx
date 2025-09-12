import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, mockUser } from '../utils/test-helpers';
import { LoginForm } from '../../src/components/auth/LoginForm';

// Mock react-router-dom
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate
}));

describe('LoginForm', () => {
  const mockOnSuccess = jest.fn();
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const renderLoginForm = (props = {}) => {
    const defaultProps = {
      onSuccess: mockOnSuccess,
      ...props
    };
    
    return renderWithProviders(<LoginForm {...defaultProps} />, {
      initialAuthState: {
        user: null,
        isAuthenticated: false,
        loading: false
      }
    });
  };

  it('should render login form correctly', () => {
    renderLoginForm();

    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByText(/don't have an account/i)).toBeInTheDocument();
  });

  it('should validate required fields', async () => {
    renderLoginForm();

    const submitButton = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });
  });

  it('should validate email format', async () => {
    renderLoginForm();

    const emailInput = screen.getByLabelText(/email address/i);
    fireEvent.change(emailInput, { target: { value: 'invalid-email' } });
    fireEvent.blur(emailInput);

    await waitFor(() => {
      expect(screen.getByText(/invalid email format/i)).toBeInTheDocument();
    });
  });

  it('should validate password minimum length', async () => {
    renderLoginForm();

    const passwordInput = screen.getByLabelText(/password/i);
    fireEvent.change(passwordInput, { target: { value: '123' } });
    fireEvent.blur(passwordInput);

    await waitFor(() => {
      expect(screen.getByText(/password must be at least 6 characters/i)).toBeInTheDocument();
    });
  });

  it('should submit form with valid data', async () => {
    renderLoginForm();

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });

  it('should show loading state during submission', async () => {
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />, {
      initialAuthState: {
        user: null,
        isAuthenticated: false,
        loading: true
      }
    });

    const submitButton = screen.getByRole('button', { name: /signing in/i });
    expect(submitButton).toBeDisabled();
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
  });

  it('should display login error', async () => {
    const mockLogin = jest.fn().mockRejectedValue(new Error('Invalid credentials'));
    
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />, {
      initialAuthState: {
        user: null,
        isAuthenticated: false,
        loading: false,
        login: mockLogin
      }
    });

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('should toggle password visibility', () => {
    renderLoginForm();

    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;
    const toggleButton = screen.getByRole('button', { name: /show password/i });

    expect(passwordInput.type).toBe('password');

    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe('text');
    expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument();

    fireEvent.click(toggleButton);
    expect(passwordInput.type).toBe('password');
  });

  it('should navigate to register page', () => {
    renderLoginForm();

    const signUpLink = screen.getByRole('link', { name: /sign up/i });
    fireEvent.click(signUpLink);

    expect(mockNavigate).toHaveBeenCalledWith('/register');
  });

  it('should navigate to forgot password page', () => {
    renderLoginForm();

    const forgotPasswordLink = screen.getByRole('link', { name: /forgot password/i });
    fireEvent.click(forgotPasswordLink);

    expect(mockNavigate).toHaveBeenCalledWith('/forgot-password');
  });

  it('should handle Enter key submission', async () => {
    renderLoginForm();

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.keyDown(passwordInput, { key: 'Enter' });

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalled();
    });
  });

  it('should clear errors on input change', async () => {
    const mockLogin = jest.fn().mockRejectedValue(new Error('Invalid credentials'));
    
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />, {
      initialAuthState: {
        user: null,
        isAuthenticated: false,
        loading: false,
        login: mockLogin
      }
    });

    // Trigger error
    const submitButton = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });

    // Start typing to clear error
    const emailInput = screen.getByLabelText(/email address/i);
    fireEvent.change(emailInput, { target: { value: 'new@example.com' } });

    await waitFor(() => {
      expect(screen.queryByText(/invalid credentials/i)).not.toBeInTheDocument();
    });
  });

  it('should remember me functionality', () => {
    renderLoginForm();

    const rememberCheckbox = screen.getByRole('checkbox', { name: /remember me/i }) as HTMLInputElement;
    expect(rememberCheckbox.checked).toBe(false);

    fireEvent.click(rememberCheckbox);
    expect(rememberCheckbox.checked).toBe(true);
  });

  it('should be accessible', async () => {
    const { container } = renderLoginForm();
    
    // Check for proper ARIA labels
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    
    // Check for proper form structure
    expect(screen.getByRole('form')).toBeInTheDocument();
    
    // Check for proper error handling
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    
    await waitFor(() => {
      const errorMessages = screen.getAllByRole('alert');
      expect(errorMessages.length).toBeGreaterThan(0);
    });
  });

  it('should handle social login', () => {
    renderLoginForm();

    const googleButton = screen.getByRole('button', { name: /continue with google/i });
    const facebookButton = screen.getByRole('button', { name: /continue with facebook/i });

    expect(googleButton).toBeInTheDocument();
    expect(facebookButton).toBeInTheDocument();

    fireEvent.click(googleButton);
    // In a real implementation, this would trigger OAuth flow
    expect(googleButton).toHaveAttribute('data-provider', 'google');
  });

  it('should prevent multiple submissions', async () => {
    const mockLogin = jest.fn().mockImplementation(() => 
      new Promise(resolve => setTimeout(resolve, 1000))
    );
    
    renderWithProviders(<LoginForm onSuccess={mockOnSuccess} />, {
      initialAuthState: {
        user: null,
        isAuthenticated: false,
        loading: false,
        login: mockLogin
      }
    });

    const emailInput = screen.getByLabelText(/email address/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    
    // First click
    fireEvent.click(submitButton);
    // Second click should be ignored
    fireEvent.click(submitButton);
    
    await waitFor(() => {
      expect(submitButton).toBeDisabled();
    });
    
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });
});