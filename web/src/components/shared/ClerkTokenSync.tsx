import { useAuth } from "@clerk/clerk-react";
import { clearAuthTokenGetter, setAuthTokenGetter } from "@/lib/authToken";
import { useLayoutEffect } from "react";

const ClerkTokenSync = () => {
  const { getToken, isSignedIn } = useAuth();

  useLayoutEffect(() => {
    setAuthTokenGetter(async () => {
      if (!isSignedIn) return null;
      return getToken();
    });

    return () => {
      clearAuthTokenGetter();
    };
  }, [getToken, isSignedIn]);

  return null;
};

export default ClerkTokenSync;
