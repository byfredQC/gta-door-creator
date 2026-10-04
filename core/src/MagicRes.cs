// Replaces CodeWalker's .resx resource accessor (resx is not compiled here): magic.dat is an embedded resource.
namespace CodeWalker.Core.Properties
{
    internal static class Resources
    {
        internal static byte[] magic
        {
            get
            {
                var asm = typeof(Resources).Assembly;
                var name = System.Linq.Enumerable.First(asm.GetManifestResourceNames(), n => n.EndsWith("magic.dat"));
                using var s = asm.GetManifestResourceStream(name);
                using var ms = new System.IO.MemoryStream(); s.CopyTo(ms); return ms.ToArray();
            }
        }
    }
}
