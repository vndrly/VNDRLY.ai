import React from "react";
import {ScrollView,Text} from "react-native";
import {useLocalSearchParams} from "expo-router";
import {z} from "zod/v4";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import FormCampaignResponse from "@/components/work-hub/FormCampaignResponse";
export default function Page(){const raw=useLocalSearchParams<{instanceId:string}>().instanceId,id=z.uuid().safeParse(raw);return <ScreenSafeArea><ScrollView contentContainerStyle={{padding:16,gap:16}}><WorkHubPageTitle title="Assigned form"/>{id.success?<FormCampaignResponse instanceId={id.data}/>:<Text>Invalid form link.</Text>}</ScrollView></ScreenSafeArea>;}
