import React from "react";
import {ScrollView,Text} from "react-native";
import {useLocalSearchParams} from "expo-router";
import {z} from "zod/v4";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import WorkHubPageTitle from "@/components/WorkHubPageTitle";
import FormCampaignProgress from "@/components/work-hub/FormCampaignProgress";
export default function Page(){const raw=useLocalSearchParams<{campaignId:string}>().campaignId,id=z.uuid().safeParse(raw);return <ScreenSafeArea><ScrollView contentContainerStyle={{padding:16,gap:16}}><WorkHubPageTitle title="Campaign progress"/>{id.success?<FormCampaignProgress campaignId={id.data}/>:<Text>Invalid form link.</Text>}</ScrollView></ScreenSafeArea>;}
