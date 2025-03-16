using BepInEx;
using EFT.InventoryLogic;
using EFT;
using SPT.Reflection.Patching;
using System.Reflection;
using HarmonyLib;
using System.Linq;

namespace DrakiaXYZ.GildedKeyStorage
{
    [BepInPlugin("xyz.drakia.gildedkeystorage", "DrakiaXYZ-GildedKeyStorage", "1.6.0")]
    [BepInDependency("com.SPT.core", "3.11.0")]
    public class GildedKeyStoragePlugin : BaseUnityPlugin
    {
        public void Awake()
        {
            new RemoveSlotItemsForMapEntryPatch().Enable();
        }
    }

    class RemoveSlotItemsForMapEntryPatch : ModulePatch
    {
        protected override MethodBase GetTargetMethod()
        {
            var desiredType = typeof(LocalGame).BaseType;
            var desiredMethod = AccessTools.FirstMethod(typeof(LocalGame).BaseType, method =>
            {
                var parms = method.GetParameters();
                return parms.Length == 2
                && parms[0].ParameterType == typeof(Profile)
                && parms[0].Name == "profile"
                && parms[1].ParameterType == typeof(string)
                && parms[1].Name == "keyId";
            });

            Logger.LogDebug($"{this.GetType().Name} Type: {desiredType?.Name}");
            Logger.LogDebug($"{this.GetType().Name} Method: {desiredMethod?.Name}");

            return desiredMethod;
        }

        [PatchPrefix]
        public static bool PatchPrefix(Profile profile, string keyId)
        {
            if (string.IsNullOrEmpty(keyId))
            {
                return false;
            }

            // Find the entry item in the user's profile
            Item itemToRemove = null;
            Item keyItem = profile.Inventory.GetPlayerItems(EPlayerItems.Equipment).FirstOrDefault(item => item.Id == keyId);
            if (keyItem != null)
            {
                KeyComponent keyComponent = keyItem.GetItemComponent<KeyComponent>();
                if (keyComponent != null)
                {
                    if (keyComponent.Template.MaximumNumberOfUsage > 0)
                    {
                        keyComponent.NumberOfUsages = keyComponent.NumberOfUsages + 1;
                        if (keyComponent.NumberOfUsages >= keyComponent.Template.MaximumNumberOfUsage)
                        {
                            itemToRemove = keyItem;
                        }
                    }
                }
                else
                {
                    itemToRemove = keyItem;
                }
            }

            // If we need to remove the item (Either not a Key, or has hit its use limit), remove it
            if (itemToRemove != null)
            {
                var container = itemToRemove.Parent.Container;
                var result = InteractionsHandlerClass.Discard(itemToRemove, (TraderControllerClass)itemToRemove.Parent.GetOwner());
                if (result.Failed)
                {
                    Logger.LogError(result.Error);
                }
            }

            // Skip original
            return false;
        }
    }
}
