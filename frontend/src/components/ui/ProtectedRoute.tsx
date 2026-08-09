import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireCaregiver?: boolean;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  requireCaregiver = false,
}) => {
  const { currentProfile, isCaregiver } = useAuth();
  if (!currentProfile) return <Navigate to="/login" replace />;
  if (requireCaregiver && !isCaregiver) return <Navigate to="/menu" replace />;
  return <>{children}</>;
};
