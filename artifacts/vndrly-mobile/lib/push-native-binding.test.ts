import {expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({api:vi.fn(),permission:vi.fn(),handler:vi.fn(),sound:vi.fn()}));
vi.mock("expo-secure-store",()=>({getItemAsync:async()=>"ExpoPushToken[synthetic]"}));
vi.mock("expo-constants",()=>({default:{}}));vi.mock("expo-device",()=>({isDevice:true}));
vi.mock("expo-notifications",()=>({setNotificationHandler:mocks.handler,requestPermissionsAsync:mocks.permission}));
vi.mock("react-native",()=>({AppState:{currentState:"active"},Platform:{OS:"ios"}}));
vi.mock("./api",()=>({apiFetch:mocks.api}));vi.mock("./auth",()=>({captureAuthScope:()=>({generation:1}),isAuthScopeCurrent:()=>true}));
vi.mock("./deviceId",()=>({getDeviceId:async()=>"35c34a3c-ef90-459d-9a4b-e980ec0c8a12"}));
vi.mock("./notificationSounds",()=>({handleForegroundNotificationSound:mocks.sound,PUSH_NOTIFICATION_SOUND:"sound"}));
vi.mock("./notificationBadge",()=>({applyPushBadgeFromPayload:vi.fn()}));vi.mock("./runtime",()=>({isExpoGo:false}));
vi.mock("./work-hub-message-sound",()=>({isWorkHubMessagePush:()=>false}));vi.mock("./work-hub-message-sound-native",()=>({handleWorkHubMessageSound:vi.fn()}));vi.mock("./notification-actions",()=>({notificationCategoryDefinitions:[]}));
import {rebindRegisteredPushToken} from "./push";
it("rebinds stored token to current device without a permission prompt",async()=>{
 await rebindRegisteredPushToken();expect(mocks.permission).not.toHaveBeenCalled();
 expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toEqual({token:"ExpoPushToken[synthetic]",platform:"ios",deviceId:"35c34a3c-ef90-459d-9a4b-e980ec0c8a12"});
});
it("keeps the headless location pointer silent even in foreground",async()=>{
 const handler=mocks.handler.mock.calls[0][0];
 const result=await handler.handleNotification({request:{content:{data:{nativeRequestId:"request"}}}});
 expect(result).toEqual({shouldShowAlert:false,shouldPlaySound:false,shouldSetBadge:false,shouldShowBanner:false,shouldShowList:false});expect(mocks.sound).not.toHaveBeenCalled();
});
