import { expect, it, vi } from "vitest";
vi.mock("react-native",()=>({Platform:{OS:"web"}}));
vi.mock("expo-secure-store",()=>({WHEN_UNLOCKED_THIS_DEVICE_ONLY:1,AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:2,getItemAsync:()=>{throw Error("Native storage called in browser");},setItemAsync:()=>{throw Error("Native storage called in browser");},deleteItemAsync:()=>{throw Error("Native storage called in browser");}}));
import {getItemAsync,setItemAsync,deleteItemAsync} from "./fleet-device-storage";
it("uses memory instead of unavailable native secure storage in browser",async()=>{await setItemAsync("test","record");expect(await getItemAsync("test")).toBe("record");await deleteItemAsync("test");expect(await getItemAsync("test")).toBeNull();});
