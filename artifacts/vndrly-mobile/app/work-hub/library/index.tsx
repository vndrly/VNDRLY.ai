import React from "react";
import {ScrollView} from "react-native";
import {useTranslation} from "react-i18next";
import {useAuth} from "@/hooks/use-auth";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import LibraryWorkspace from "@/components/work-hub/library/LibraryWorkspace";
export default function Page(){const {t}=useTranslation(),{user}=useAuth(),member=user?.availableMemberships?.find(m=>m.id===user.activeMembershipId);return <ScreenSafeArea><ScrollView contentContainerStyle={{padding:16,gap:16}}><WorkHubPageTitle title={t("workHubLibrary.manage")}/><LibraryWorkspace canManage={user?.role==="admin"||member?.role==="admin"}/></ScrollView></ScreenSafeArea>;}
