import React from "react";
import {Image,View} from "react-native";
import {useAuth} from "@/hooks/use-auth";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import LibraryWorkspace from "@/components/work-hub/library/LibraryWorkspace";
export default function Page(){const {user}=useAuth(),member=user?.availableMemberships?.find(m=>m.id===user.activeMembershipId);return <ScreenSafeArea><View style={{flex:1,minHeight:0,padding:16,gap:16}}><WorkHubPageTitle title="VNDRLY/U" titleNode={<Image accessibilityRole="header" accessibilityLabel="VNDRLY/U" source={require("@/assets/images/vndrly-u-wordmark.png")} resizeMode="contain" style={{width:158,height:25}}/>}/><LibraryWorkspace canManage={user?.role==="admin"||member?.role==="admin"}/></View></ScreenSafeArea>;}
