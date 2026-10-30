   import { useEffect, useState } from "react";
   import { api } from "./api";

   export function useData<T>(path: string) {
     const [state, setState] = useState<{ path: string; data: T | null; error: string }>({
       path,
       data: null,
       error: "",
     });
     useEffect(() => {
       let live = true;
       api<T>(path)
         .then((data) => live && setState({ path, data, error: "" }))
         .catch((e) => live && setState({ path, data: null, error: e.message }));
       return () => {
         live = false;
       };
     }, [path]);
     return state.path === path ? { data: state.data, error: state.error } : { data: null, error: "" };
   }