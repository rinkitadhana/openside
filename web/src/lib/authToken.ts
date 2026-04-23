type AuthTokenGetter = () => Promise<string | null>;

let authTokenGetter: AuthTokenGetter | null = null;

export const setAuthTokenGetter = (getter: AuthTokenGetter) => {
  authTokenGetter = getter;
};

export const clearAuthTokenGetter = () => {
  authTokenGetter = null;
};

export const getAuthToken = async (): Promise<string | null> => {
  if (!authTokenGetter) return null;
  return authTokenGetter();
};
