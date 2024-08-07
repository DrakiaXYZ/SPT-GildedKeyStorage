/* eslint-disable @typescript-eslint/brace-style */
import * as config from "../config/config.json";

import type { ILogger } from "@spt/models/spt/utils/ILogger";
import { LogTextColor } from "@spt/models/spt/logging/LogTextColor";
import type { ITemplateItem } from "@spt/models/eft/common/tables/ITemplateItem";
import { BaseClasses } from "@spt/models/enums/BaseClasses";
import type { StaticRouterModService } from "@spt/services/mod/staticRouter/StaticRouterModService";
import type { SaveServer } from "@spt/servers/SaveServer";
import type { ItemHelper } from "@spt/helpers/ItemHelper";

const debugConfig = config.debug
const keysInConfig:Array<string> = [
    ...config["Golden Keycard Case"].slot_ids,
    ...config["Golden Keychain Mk. I"].slot_ids,
    ...config["Golden Keychain Mk. II"].slot_ids,
    ...config["Golden Keychain Mk. III"].slot_ids
]

export class Debug{
    logMissingKeys(logger:ILogger, itemHelper:ItemHelper, dbItems:Record<string, ITemplateItem>, dbLocales: Record<string, string>):void{
        if (!debugConfig.log_missing_keys) return

        logger.log("[Gilded Key Storage]: Keys missing from config: ", LogTextColor.MAGENTA)
        logger.log("-------------------------------------------", LogTextColor.YELLOW)

        for (const itemID in dbItems){
            const thisItem = dbItems[itemID]

            // Skip items that aren't items
            if (thisItem._type !== "Item") continue;

            // Skip non-keys
            if (!itemHelper.isOfBaseclass(thisItem._id, BaseClasses.KEY)) continue;

            // Skip quest keys
            if (thisItem._props.QuestItem) continue;

            if (this.isKeyMissing(itemID)){

                logger.log(dbLocales[`${itemID} Name`], LogTextColor.MAGENTA)
                logger.log(itemID, LogTextColor.MAGENTA)
                logger.log("-------------------------------------------", LogTextColor.YELLOW)
            }
        }
    }

    isKeyMissing(keyId:string):boolean{
        if (keysInConfig.includes(keyId)){
            return false
        }
        
        return true
    }

    giveProfileAllKeysAndGildedCases(staticRouterModService:StaticRouterModService, saveServer: SaveServer, logger:ILogger):void{
        if (!debugConfig.give_profile_all_keys) return

        staticRouterModService.registerStaticRouter(
            "On_Game_Start_Gilded_Key_Storage",
            [{
                url: "/client/game/start",
                action: async (url, info, sessionId, output) => {

                    const profile = saveServer.getProfile(sessionId)
                    const profileInventory = profile.characters?.pmc?.Inventory

                    if (!profileInventory){
                        logger.log("New profile detected! load to stash, then close and reopen SPT to receive all keys and gilded cases", LogTextColor.RED)
                        return output
                    }

                    const itemIdsToPush = this.getArrayOfKeysAndCases()

                    let xVal = 0
                    let yVal = 0

                    for (let i = 0; i < itemIdsToPush.length; i++){
                        const thisItemId = itemIdsToPush[i]

                        xVal++

                        if (xVal > 9){
                            xVal = 0
                            yVal += 1
                        }

                        profileInventory.items.push(
                            {
                                _id: `${thisItemId}_gilded_debug_id`,
                                _tpl: thisItemId,
                                parentId: profileInventory.stash,
                                slotId: "hideout",
                                location: {
                                    x: xVal,
                                    y: yVal,
                                    r: "Horizontal",
                                    isSearched: true
                                }
                            }
                        )

                        profile.characters.pmc.Encyclopedia[thisItemId] = true
                    }
                    return output
                }
            }],
            "spt"
        );
    }

    removeAllDebugInstanceIdsFromProfile(staticRouterModService:StaticRouterModService, saveServer: SaveServer):void{

        if (!debugConfig.give_profile_all_keys && !debugConfig.force_remove_debug_items_on_start) return

        let urlHook = "/client/game/logout"
        if (debugConfig.force_remove_debug_items_on_start){
            urlHook = "/client/game/start"
        }

        staticRouterModService.registerStaticRouter(
            "On_Logout_Gilded_Key_Storage",
            [{
                url: urlHook,
                action: async (url, info, sessionId, output) => {

                    const profile = saveServer.getProfile(sessionId)
                    const profileInventory = profile.characters?.pmc?.Inventory
                    const profileItems = profileInventory.items

                    if (!profileInventory){return output}

                    for (let i = profileItems.length; i > 0; i--){

                        const itemKey = i-1

                        if (profileItems[itemKey]._id.includes("_gilded_debug_id")){

                            profileInventory.items.splice(itemKey, 1)
                        }  
                    }

                    return output
                }
            }],
            "spt"
        );
    }


    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    getArrayOfKeysAndCases():Array<any>{
        const keysAndCases = [
            ...keysInConfig,
            config["Golden Key Pouch"].id,
            config["Golden Keycard Case"].id,
            config["Golden Keychain Mk. I"].id,
            config["Golden Keychain Mk. II"].id,
            config["Golden Keychain Mk. III"].id
        ]

        for (let i = keysAndCases.length; i > 0; i--){
            const top = i-1
           
            for (let x = keysAndCases.length; x > 0; x--){
                const bottom = x-1
                
                if (top !== bottom){
                    
                    if (keysAndCases[top] === keysAndCases[bottom]){

                        keysAndCases.splice(bottom, 1)
                    }
                }
            }
        }

        return keysAndCases
    }
}